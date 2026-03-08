import { UI, initLanguages, setStatus, setPowerBtn, resetMeters, updateHarvestTable, interimSpan, renderState, startRenderLoop } from './ui.js';
import { loadStopWords, fetchZeitgeist, extractValuableTokens, experienceDict, referenceDict } from './zeitgeist.js';
import { AudioProcessor } from './audio.js';

let workerStore = { vad: null, whisper: null, nlp: null };
let audioProcessor = new AudioProcessor();
let isCoreLoaded = false;
let isBootingUp = false;
let activeToken = null;
let transcriptBuffer = [];
let lastSegmentTime = 0;
let lastInterimWords = []; // Tracks current interim word list for word-diff streaming

// Funzione helper per risolvere i worker in modo compatibile con sottocartelle (GitHub Pages)
function getWorkerUrl(scriptName) {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    // Pesa il pathname correntemente per assicurare i percorsi relativi su GitHub Pages (es. /WHISP-main-10/src/...)
    const p = window.location.pathname;
    const dir = p.substring(0, p.lastIndexOf('/'));
    return `${dir}/src/workers/${scriptName}`;
}

function initWorkers() {
    if (workerStore.vad?.worker) return; // Idempotency: abort if already initialized
    
    workerStore.vad = { worker: new Worker(getWorkerUrl('vad.worker.js'), { type: 'module' }) };
    workerStore.whisper = { worker: new Worker(getWorkerUrl('whisper.worker.js'), { type: 'module' }) };
    workerStore.nlp = { worker: new Worker(getWorkerUrl('nlp.worker.js')) };

    // Worker crash handlers — surface errors to the UI instead of silent failure
    const onWorkerError = (name) => (e) => {
        console.error(`[APEX] ${name} Worker crashed:`, e.message || e);
        setStatus(`${name}_FAULT`, 'var(--term-err)');
        setPowerBtn('▶', undefined, false);
        isBootingUp = false;
    };
    workerStore.vad.worker.onerror = onWorkerError('VAD');
    workerStore.whisper.worker.onerror = onWorkerError('WHISPER');
    workerStore.nlp.worker.onerror = onWorkerError('NLP');

    const channel = new MessageChannel();
    workerStore.vad.worker.postMessage({ type: 'init_whisper_port', port: channel.port1 }, [channel.port1]);
    workerStore.whisper.worker.postMessage({ type: 'init_vad_port', port: channel.port2 }, [channel.port2]);

    workerStore.nlp.worker.onmessage = (e) => {
        if (e.data.type === 'NLP_DONE') {
            if (e.data.tokens.length === 0) return;

            const now = Date.now();
            const silenceGap = lastSegmentTime > 0 ? now - lastSegmentTime : 0;
            lastSegmentTime = now;

            // Clear interim streams and reset word tracker
            interimSpan.innerHTML = '';
            lastInterimWords = [];

            const frag = document.createDocumentFragment();
            if (silenceGap > 2500 && UI.output.querySelector('.word-token')) {
                const br = document.createElement('div');
                br.style.cssText = 'display:block; height:0.8em; width:100%;';
                frag.appendChild(br);
                transcriptBuffer.push('\n\n');
            }

            const STREAM_DELAY_MS = 35;
            e.data.tokens.forEach((t, i) => {
                const s = document.createElement('span');
                s.className = 'word-token' + (t.isLowConf ? ' low-conf' : '') + (t.healed ? ' validated' : '');
                s.innerText = ' ' + t.text;
                s.style.animationDelay = `${i * STREAM_DELAY_MS}ms`;
                frag.appendChild(s);
                transcriptBuffer.push(' ' + t.text);
            });

            UI.output.insertBefore(frag, interimSpan);
            interimSpan.innerText = '';
            UI.output.scrollTop = UI.output.scrollHeight;
        }
    };

    workerStore.whisper.worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') {
            let progDiv = document.getElementById('dl-progress');
            if(!progDiv) {
                progDiv = document.createElement('div');
                progDiv.id = 'dl-progress';
                progDiv.className = 'sys-log';
                UI.output.appendChild(progDiv);
            }
            const pText = 'FETCHING NEURAL WEIGHTS: ' + Math.round(d.p || 0) + '%';
            const b = Math.floor((d.p || 0)/5); 
            progDiv.innerText = pText + ' [' + '#'.repeat(b) + '-'.repeat(20 - b) + ']';
            UI.output.scrollTop = UI.output.scrollHeight;
        } else if (d.type === 'READY_TO_PROCESS') { 
            const progDiv = document.getElementById('dl-progress');
            if(progDiv) progDiv.style.display = 'none';
            isCoreLoaded = true; 
            setPowerBtn("■", "var(--term-warn)", false);
            setStatus("ONLINE", "var(--term-ok)");
            UI.output.appendChild(interimSpan);
            if (!document.getElementById('termCursor')) {
                const cursor = document.createElement('span');
                cursor.className = 'terminal-cursor';
                cursor.id = 'termCursor';
                UI.output.appendChild(cursor);
            }
        } else if (d.type === 'GPU_LOST') {
            // GPU hardware crash — surface clearly to user instead of freezing
            setStatus('GPU_FAULT', 'var(--term-err)');
            setPowerBtn('▶', undefined, false);
            isCoreLoaded = false;
            isBootingUp = false;
            const errDiv = document.createElement('div');
            errDiv.className = 'sys-log';
            errDiv.style.color = 'var(--term-err)';
            errDiv.innerText = `[APEX] GPU CONTEXT LOST: ${d.reason || 'unknown'}. RELOAD PAGE TO RECOVER.`;
            UI.output.appendChild(errDiv);
        } else if (d.type === 'final') {
            if (d.avgConf !== undefined) renderState.asrProb = d.avgConf;
            workerStore.nlp.worker.postMessage({
                type: 'PROCESS_TEXT', text: d.text, isLowConf: d.isLowConf,
                wordConf: d.wordConf || null,
                priorityPool: Array.from(experienceDict), referenceDict: Array.from(referenceDict)
            });
        } else if (d.type === 'partial') {
            if (d.avgConf !== undefined) renderState.asrProb = d.avgConf;
            // [STREAM]: Word-diff interim streaming — only animate NEW words arriving
            // Compares current word list with previous to find appended words only
            const newWords = d.text.trim().split(/\s+/).filter(Boolean);
            const prevCount = lastInterimWords.length;
            const addedWords = newWords.slice(prevCount);
            lastInterimWords = newWords;

            if (addedWords.length > 0) {
                const existingSpans = interimSpan.querySelectorAll('.interim-word').length;
                addedWords.forEach((word, i) => {
                    const ws = document.createElement('span');
                    ws.className = 'interim-word interim-text';
                    ws.innerText = ' ' + word;
                    ws.style.animationDelay = `${i * 40}ms`;
                    ws.style.animation = 'wordStreamIn 0.2s ease-out both';
                    interimSpan.appendChild(ws);
                });
            } else if (newWords.length < prevCount) {
                // Whisper revised a word — clear and re-render cleanly
                interimSpan.innerHTML = '';
                newWords.forEach((word, i) => {
                    const ws = document.createElement('span');
                    ws.className = 'interim-word interim-text';
                    ws.innerText = ' ' + word;
                    interimSpan.appendChild(ws);
                });
            }
            UI.output.scrollTop = UI.output.scrollHeight;
        }
    };

    workerStore.vad.worker.onmessage = (e) => {
        if (e.data.type === 'ready') {
            workerStore.whisper.worker.postMessage({ type: 'load', precision: UI.precisionSelect.value });
        } else if (e.data.type === 'vad_ui_update') {
            // [APEX TUNING]: Deleghiamo l'update del DOM al RequestAnimationFrame per non saturare la CPU
            renderState.prob = e.data.prob;
            renderState.rms = e.data.rms;
            renderState.isSpeaking = e.data.isSpeaking;
            renderState.needsRender = true;
        }
    };
}

async function runBootSequence() {
    UI.output.innerHTML = "";
    const lines = [
        "INITIALIZING APEX KERNEL...",
        "ALLOCATING AUDIO BUFFERS [OK]",
        "MOUNTING WORKER THREADS [OK]",
        "SYNCING LOCAL DICTIONARY [OK]",
        "WAKING NEURAL ENGINE...",
        " ",
        "  ██╗    ██╗██╗  ██╗██╗███████╗██████╗ ",
        "  ██║    ██║██║  ██║██║██╔════╝██╔══██╗",
        "  ██║ █╗ ██║███████║██║███████╗██████╔╝",
        "  ██║███╗██║██╔══██║██║╚════██║██╔═══╝ ",
        "  ╚███╔███╔╝██║  ██║██║███████║██║     ",
        "   ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝╚══════╝╚═╝     ",
        "> MATTIA DAVIDE AMICO // APEX ENGINE",
        " ",
        "SYSTEM ONLINE. AWAITING AUDIO FLOW..."
    ];
    for (let i = 0; i < lines.length; i++) {
        const div = document.createElement('div');
        div.className = i >= 6 && i <= 12 ? 'sys-log brand' : 'sys-log';
        div.innerText = lines[i];
        UI.output.appendChild(div);
        UI.output.scrollTop = UI.output.scrollHeight;
        await new Promise(r => setTimeout(r, i >= 6 && i <= 11 ? 30 : 150));
    }
}

// Event Bindings
UI.sysPowerBtn.onclick = async () => { 
    // Feature detection — fail fast on incompatible browsers
    if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('MEDIA_API_UNSUPPORTED', 'var(--term-err)');
        return;
    }
    if (!crossOriginIsolated) {
        setStatus('ISOLATION_REQUIRED', 'var(--term-err)');
        console.error('[APEX] Page must be cross-origin isolated (COOP/COEP headers missing).');
        return;
    }
    
    if (!isCoreLoaded && !isBootingUp) {
        isBootingUp = true;
        setPowerBtn("...", undefined, true);
        try {
            // Run boot animation sequentially FIRST to guarantee 60fps without WASM compilation interrupting
            await runBootSequence();
            
            initWorkers();
            workerStore.whisper.worker.postMessage({ type: 'update_params', language: UI.languageSelect.value, precision: UI.precisionSelect.value });
            workerStore.nlp.worker.postMessage({ type: 'update_params', language: UI.languageSelect.value });
            workerStore.vad.worker.postMessage({ type: 'update_params', precision: UI.precisionSelect.value });
            
            UI.zeitgeistLog.innerText = "";
            
            // [OPT 2026]: Non-blocking background dictionary sync. Do not halt the critical boot path.
            loadStopWords(UI.languageSelect.value).then(() => {
                return fetchZeitgeist(UI.domainSelect.value);
            }).catch(e => console.error("Zeitgeist background load failed:", e));
            
            await audioProcessor.init(UI.audioSource.value, workerStore.vad.worker);
            
            workerStore.vad.worker.postMessage({ type: 'load' });
            
            // Wait for Whisper worker to finish loading (isBootingUp is managed inside worker logic or when mic starts)
            isBootingUp = false;
            
        } catch (err) { 
            setPowerBtn("▶", undefined, false);
            setStatus("MIC_ERROR", "var(--term-err)"); 
            console.error("Boot Error:", err);
            isBootingUp = false;
        }
    } else if (audioProcessor.isRecording) {
        audioProcessor.stop();
        workerStore.vad.worker.postMessage({ type: 'force_flush' });
        
        setPowerBtn("▶", "var(--term-main)");
        setStatus("PAUSED", "var(--term-dim)");
        resetMeters();
    } else {
        await audioProcessor.init(UI.audioSource.value, workerStore.vad.worker);
        setPowerBtn("■", "var(--term-warn)");
        setStatus("ONLINE", "var(--term-ok)");
        UI.output.appendChild(interimSpan);
        if (!document.getElementById('termCursor')) {
             const cursor = document.createElement('span'); cursor.className = 'terminal-cursor'; cursor.id = 'termCursor'; UI.output.appendChild(cursor);
        }
    }
};

UI.languageSelect.onchange = (e) => {
    if (workerStore.whisper) workerStore.whisper.worker.postMessage({ type: 'update_params', language: e.target.value });
    if (workerStore.nlp) workerStore.nlp.worker.postMessage({ type: 'update_params', language: e.target.value });
    loadStopWords(e.target.value);
};

UI.precisionSelect.onchange = (e) => {
    if (workerStore.vad) workerStore.vad.worker.postMessage({ type: 'update_params', precision: e.target.value });
    if (workerStore.whisper) workerStore.whisper.worker.postMessage({ type: 'update_params', precision: e.target.value });
};

UI.domainSelect.onchange = (e) => { if (e.target.value === 'custom') UI.dictFileInput.click(); };
UI.dictFileInput.onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { 
        extractValuableTokens(ev.target.result); 
        UI.zeitgeistLog.innerText += `\n> CUSTOM_DICT_LOADED [TOKENS: ${referenceDict.size}]`; 
        if (workerStore.whisper && workerStore.whisper.worker) {
            workerStore.whisper.worker.postMessage({ type: 'update_params', prompt: Array.from(referenceDict).join(' ') });
        }
    };
    reader.readAsText(file);
};

UI.output.addEventListener('click', (e) => {
    if (e.target.classList.contains('word-token')) {
        activeToken = e.target; 
        UI.editInput.value = activeToken.innerText.trim(); 
        UI.popup.style.display = 'block';
        UI.popup.style.left = `${e.pageX}px`; 
        UI.popup.style.top = `${e.pageY + 10}px`; 
        UI.editInput.focus();
    }
});

UI.confirmBtn.onclick = () => {
    if (activeToken) {
        const newVal = UI.editInput.value.trim(); 
        activeToken.innerText = " " + newVal; 
        activeToken.className = 'word-token validated';
        experienceDict.add(newVal.toLowerCase()); 
        updateHarvestTable(newVal, 'MANUAL_VALIDATION');
    }
    UI.popup.style.display = 'none'; 
    activeToken = null;
};

document.addEventListener('click', (e) => { 
    if (!UI.popup.contains(e.target) && !e.target.classList.contains('word-token')) {
        UI.popup.style.display = 'none'; 
    }
});

function getWatermarkedTranscript() {
    // Use in-memory buffer — O(1) instead of O(n) DOM traversal
    const text = (transcriptBuffer.join('') + interimSpan.innerText).trim();
    if (!text) return "";
    const watermark = `\n\n=========================================\n TRANSCRIBED VIA WHISP APEX ENGINE v5.1\n > DESIGN BY MATTIA DAVIDE AMICO\n=========================================\n`;
    return text + watermark;
}

UI.clearBtn.onclick = () => { 
    const logs = UI.output.querySelectorAll('.sys-log');
    UI.output.innerHTML = ""; 
    logs.forEach(l => UI.output.appendChild(l));
    UI.output.appendChild(interimSpan); 
    transcriptBuffer = []; // Clear the in-memory buffer too
    const cursor = document.createElement('span'); cursor.className = 'terminal-cursor'; UI.output.appendChild(cursor);
};
UI.copyBtn.onclick = () => {
    const txt = getWatermarkedTranscript();
    if (txt) navigator.clipboard.writeText(txt);
}
UI.toggleHarvestBtn.onclick = () => { UI.harvestPanel.style.display = UI.harvestPanel.style.display === 'block' ? 'none' : 'block'; };
UI.closeHarvestBtn.onclick = () => { UI.harvestPanel.style.display = 'none'; };
UI.exportBtn.onclick = () => { 
    const txt = getWatermarkedTranscript();
    if (!txt) return;
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(new Blob([txt], {type: 'text/plain'})); 
    a.download = 'WHISP_TRANSCRIPT.txt'; 
    a.click(); 
};

// Bootstrap
initLanguages();
startRenderLoop();
