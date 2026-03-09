import { UI, initLanguages, setStatus, setPowerBtn, resetMeters, updateHarvestTable, interimSpan, renderState, startRenderLoop } from './ui.js';
import { loadStopWords, fetchZeitgeist, extractValuableTokens, experienceDict, referenceDict, boostToken } from './zeitgeist.js';
import { AudioProcessor } from './audio.js';
let workerStore = { vad: null, whisper: null, nlp: null };
let audioProcessor = new AudioProcessor();
let isCoreLoaded = false;
let isBootingUp = false;
let hasBooted = false;
let activeToken = null;
let transcriptBuffer = [];
let lastSegmentTime = 0;
let lastInterimWords = []; 

// [CLOSED-LOOP PROMPT RE-SYNC]
// Debounced scheduler: after new low-conf tokens are boosted into referenceDict,
// we wait a short idle window before pushing the updated top-N prompt to Whisper.
// This avoids spamming postMessage on every single segment.
let _promptSyncTimer = null;
function schedulePromptReSync(debounceMs = 8000) {
    if (_promptSyncTimer) return; // already pending
    _promptSyncTimer = setTimeout(() => {
        _promptSyncTimer = null;
        if (workerStore.whisper?.worker) {
            const newPrompt = window.buildOptimizedPrompt();
            workerStore.whisper.worker.postMessage({ type: 'update_params', prompt: newPrompt });
        }
    }, debounceMs);
}
function getWorkerUrl(scriptName) {
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const p = window.location.pathname;
    const dir = p.substring(0, p.lastIndexOf('/'));
    return `${dir}/src/workers/${scriptName}`;
}
function initWorkers() {
    if (workerStore.vad?.worker) return; 
    window.buildOptimizedPrompt = function() {
        const sortedRss = Array.from(referenceDict.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 80)
            .map(e => e[0]);
        const manualWords = Array.from(experienceDict);
        return [...manualWords, ...sortedRss].join(', ');
    };
    workerStore.vad = { worker: new Worker(getWorkerUrl('vad.worker.js'), { type: 'module' }) };
    workerStore.whisper = { worker: new Worker(getWorkerUrl('whisper.worker.js'), { type: 'module' }) };
    workerStore.nlp = { worker: new Worker(getWorkerUrl('nlp.worker.js')) };
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
        if (e.data.type === 'progress') {
            handleProgressEvent(e.data);
            return;
        }
        if (e.data.type === 'NLP_DONE') {
            if (e.data.tokens.length === 0) {
                interimSpan.innerHTML = '';
                lastInterimWords = [];
                return;
            }
            const now = Date.now();
            const silenceGap = lastSegmentTime > 0 ? now - lastSegmentTime : 0;
            lastSegmentTime = now;
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
            interimSpan.innerHTML = ''; 
            UI.output.appendChild(interimSpan);
            UI.output.scrollTop = UI.output.scrollHeight;
        }
    };
// Reusable handler for all worker progress events (Whisper, VAD, NLP)
function handleProgressEvent(d) {
    if (d.type === 'progress') {
        const fileName = d.file || d.name || 'unknown';
        if (!fileName) return; 

        let safeId = 'dl-' + fileName.replace(/[^a-zA-Z0-9-]/g, '-');
        let progDiv = document.getElementById(safeId);
        
        if (!progDiv) {
            progDiv = document.createElement('div');
            progDiv.id = safeId;
            progDiv.className = 'sys-log';
            if (interimSpan.parentNode === UI.output) {
                UI.output.insertBefore(progDiv, interimSpan);
            } else {
                UI.output.appendChild(progDiv);
            }
        }
        
        if (d.status === 'done' || d.status === 'ready') {
            progDiv.innerText = `CORE_[${fileName.toUpperCase()}]: 100% [####################] - DONE`;
        } else if (d.status === 'initiate') {
            progDiv.innerText = `CORE_[${fileName.toUpperCase()}]: INITIATING...`;
        } else {
            const p = d.p || 0;
            const pText = `CORE_[${fileName.substring(0,20).toUpperCase()}]: ` + Math.round(p) + '%';
            const b = Math.floor(p/5); 
            progDiv.innerText = pText + ' [' + '#'.repeat(b) + '-'.repeat(20 - b) + ']';
        }
        UI.output.scrollTop = UI.output.scrollHeight;
    }
}

    workerStore.whisper.worker.onmessage = (e) => {
        const d = e.data;
        if (d.type === 'progress') {
            handleProgressEvent(d);
        } else if (d.type === 'READY_TO_PROCESS') { 
            const finalNode = document.createElement('div');
            finalNode.className = 'sys-log';
            finalNode.style.color = 'var(--term-ok)';
            finalNode.style.fontWeight = 'bold';
            finalNode.innerText = 'CORE_ENGINE: 100% [####################] - ONLINE';
            if (interimSpan.parentNode === UI.output) {
                UI.output.insertBefore(finalNode, interimSpan);
            } else {
                UI.output.appendChild(finalNode);
            }
            isCoreLoaded = true; 
            
            // Force the button to turn red (Stop) if we are actively recording, 
            // otherwise set it to green (Ready)
            if (audioProcessor.isRecording) {
                setPowerBtn("■", "var(--term-warn)", false);
            } else {
                setPowerBtn("▶", "var(--term-main)", false);
            }
            setStatus("READY", "var(--term-ok)");
            UI.output.appendChild(interimSpan);
            if (!document.getElementById('termCursor')) {
                const cursor = document.createElement('span');
                cursor.className = 'terminal-cursor';
                cursor.id = 'termCursor';
                UI.output.appendChild(cursor);
            }
        } else if (d.type === 'GPU_LOST') {
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
            if (d.queueLength !== undefined) { renderState.queue = d.queueLength; renderState.needsRender = true; }

            // [CLOSED-LOOP FEEDBACK]: Boost low-confidence tokens back into Zeitgeist.
            // Whisper's per-chunk confidence (wordConf) tells us exactly which words
            // it was uncertain about. Elevating those tokens in referenceDict ensures
            // they appear in the next Whisper prompt re-sync, priming cross-attention
            // to favour them in future audio that contains the same vocabulary.
            if (d.wordConf && d.wordConf.length > 0) {
                let hadLowConf = false;
                for (const chunk of d.wordConf) {
                    if (chunk.isLowConf) {
                        boostToken(chunk.text);
                        hadLowConf = true;
                    }
                }
                if (hadLowConf) schedulePromptReSync();
            }

            workerStore.nlp.worker.postMessage({
                type: 'PROCESS_TEXT', text: d.text, isLowConf: d.isLowConf,
                wordConf: d.wordConf || null,
                lastPartialText: d.lastPartialText || '',
                priorityPool: Array.from(experienceDict),
                referenceDict: Array.from(referenceDict.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 150)
                    .map(e => e[0])
            });
        } else if (d.type === 'partial') {
            if (d.avgConf !== undefined) renderState.asrProb = d.avgConf;
            if (d.queueLength !== undefined) { renderState.queue = d.queueLength; renderState.needsRender = true; }
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
        if (e.data.type === 'progress') {
            handleProgressEvent(e.data);
        } else if (e.data.type === 'ready') {
            workerStore.whisper.worker.postMessage({ type: 'load', precision: UI.precisionSelect.value });
        } else if (e.data.type === 'vad_ui_update') {
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
        "INITIALIZING KERNEL...",
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
        "> MATTIA DAVIDE AMICO",
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
    UI.output.appendChild(interimSpan); // Reattach safely after boot animation wipe
}
UI.sysPowerBtn.onclick = async () => { 
    if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('MEDIA_API_UNSUPPORTED', 'var(--term-err)');
        return;
    }
    if (!crossOriginIsolated) {
        setStatus('ISOLATION_REQUIRED', 'var(--term-err)');
        console.error('[APEX] Page must be cross-origin isolated (COOP/COEP headers missing).');
        return;
    }
    if (!hasBooted && !isBootingUp) {
        isBootingUp = true;
        setPowerBtn("...", undefined, true);
        try {
            await runBootSequence();
            hasBooted = true;
            
            // [START INITIALIZATION AFTER BOOT LOGS START]
            const lang = UI.languageSelect?.value || 'italian';
            const domain = UI.domainSelect?.value;
            const precision = UI.precisionSelect?.value || 'turbo';

            initWorkers();
            workerStore.whisper.worker.postMessage({ type: 'update_params', language: lang, precision: precision });
            workerStore.nlp.worker.postMessage({ type: 'update_params', language: lang });
            workerStore.vad.worker.postMessage({ type: 'update_params', precision: precision });
            
            // Trigger load for VAD engine (VAD will dynamically trigger Whisper once it's completely ready)
            workerStore.vad.worker.postMessage({ type: 'load' }); 

            // Background dictionary sync
            loadStopWords(lang).then(() => {
                return fetchZeitgeist(domain, lang);
            }).catch(e => console.warn('[APEX] Zeitgeist load failed:', e));

            isBootingUp = false;
            // Note: Power button will be updated to ■ by READY_TO_PROCESS signal from whisper worker
            
            await audioProcessor.init(UI.audioSource.value, workerStore.vad.worker);
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
        window.dispatchEvent(new CustomEvent('zeitgeist_sync_done', { detail: { count: referenceDict.size } }));
        if (workerStore.whisper && workerStore.whisper.worker) {
            workerStore.whisper.worker.postMessage({ type: 'update_params', prompt: window.buildOptimizedPrompt() });
        }
    };
    reader.readAsText(file);
};
window.addEventListener('zeitgeist_sync_done', () => {
    if (workerStore.whisper && workerStore.whisper.worker) {
        workerStore.whisper.worker.postMessage({ type: 'update_params', prompt: window.buildOptimizedPrompt() });
    }
});
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
    const text = (transcriptBuffer.join('') + interimSpan.innerText).trim();
    if (!text) return "";
    const watermark = `\n\n=========================================\n TRANSCRIBED VIA WHISP v1.0\n > DESIGN BY MATTIA DAVIDE AMICO\n=========================================\n`;
    return text + watermark;
}
UI.clearBtn.onclick = () => { 
    const logs = UI.output.querySelectorAll('.sys-log');
    UI.output.innerHTML = ""; 
    logs.forEach(l => UI.output.appendChild(l));
    UI.output.appendChild(interimSpan); 
    transcriptBuffer = []; 
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
(async () => {
    // ONLY INITIALIZE LANGUAGES ON LOAD
    try {
        initLanguages();
        startRenderLoop(workerStore);
        // Wait for user interaction (Play button) to start workers and downloads
    } catch (e) {
        console.warn('[APEX] GUI initialization failed:', e);
    }
})();