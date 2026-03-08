import { UI, initLanguages, setStatus, setPowerBtn, resetMeters, updateHarvestTable, interimSpan, renderState, startRenderLoop } from './ui.js';
import { loadStopWords, fetchZeitgeist, extractValuableTokens, experienceDict, referenceDict } from './zeitgeist.js';
import { AudioProcessor } from './audio.js';

let workerStore = { vad: null, whisper: null, nlp: null };
let audioProcessor = new AudioProcessor();
let isCoreLoaded = false;
let isBootingUp = false; // Guard against rapid double-click
let activeToken = null;
let transcriptBuffer = []; // In-memory transcript — avoids O(n) DOM re-query every export

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
            const frag = document.createDocumentFragment(); 
            e.data.tokens.forEach(t => {
                const s = document.createElement('span');
                s.className = 'word-token' + (t.isLowConf ? ' low-conf' : '') + (t.healed ? ' validated' : '');
                s.innerText = " " + t.text;
                frag.appendChild(s);
                transcriptBuffer.push(" " + t.text); // Keep in-memory copy
            });
            UI.output.insertBefore(frag, interimSpan);
            interimSpan.innerText = "";
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
        } else if (d.type === 'final') {
            workerStore.nlp.worker.postMessage({
                type: 'PROCESS_TEXT', text: d.text, isLowConf: d.isLowConf,
                wordConf: d.wordConf || null,
                priorityPool: Array.from(experienceDict), referenceDict: Array.from(referenceDict)
            });
        } else if (d.type === 'partial') { 
            interimSpan.innerText = " " + d.text.trim() + "..."; 
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
            // Boot animation and worker init run in parallel
            const bootAnim = runBootSequence();
            
            initWorkers();
            workerStore.whisper.worker.postMessage({ type: 'update_params', language: UI.languageSelect.value, precision: UI.precisionSelect.value });
            workerStore.nlp.worker.postMessage({ type: 'update_params', language: UI.languageSelect.value });
            workerStore.vad.worker.postMessage({ type: 'update_params', precision: UI.precisionSelect.value });
            
            UI.zeitgeistLog.innerText = "";
            await loadStopWords(UI.languageSelect.value);
            
            await audioProcessor.init(UI.audioSource.value, workerStore.vad.worker);
            
            workerStore.vad.worker.postMessage({ type: 'load' });
            await fetchZeitgeist(UI.domainSelect.value);
            
            // Wait for animation to finish if still running
            await bootAnim;
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
