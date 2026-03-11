import { UI, initLanguages, setPowerBtn, startRenderLoop, interimSpan, cursorSpan } from './ui.js';
import { loadStopWords, fetchZeitgeist, extractValuableTokens, experienceDict } from './zeitgeist.js';
import { ASCII_LOGO, SIGNATURE } from './logo_header.js';
import { AudioProcessor } from './audio.js';

let workerStore = { vad: null, whisper: null, nlp: null };
let audioProcessor = new AudioProcessor();
let hasBooted = false;

// Boot Sequence con Terminale Animato
async function runBootSequence() {
    UI.output.innerHTML = "";
    const lines = [
        "WHISP KERNEL v1.0.2 - BUILD 0x3F2A",
        `CPU: ${navigator.hardwareConcurrency} CORES DETECTED`,
        "WEBGPU: SUPPORTED",
        "ENGINE: DICTIONARY_VAD_CORE [ONLINE]",
        "",
        ASCII_LOGO,
        SIGNATURE
    ];

    for (let line of lines) {
        const div = document.createElement('div');
        div.className = line === ASCII_LOGO ? 'sys-log brand' : 'sys-log';
        div.innerText = line;
        UI.output.appendChild(div);
        UI.output.scrollTop = UI.output.scrollHeight;
        await new Promise(r => setTimeout(r, 30));
    }
    UI.output.appendChild(interimSpan);
}

UI.sysPowerBtn.onclick = async () => {
    if (!hasBooted) {
        await runBootSequence();
        hasBooted = true;
        
        // Inizializzazione Worker
        workerStore.vad = { worker: new Worker('src/workers/vad.worker.js', { type: 'module' }) };
        workerStore.whisper = { worker: new Worker('src/workers/whisper.worker.js', { type: 'module' }) };
        workerStore.nlp = { worker: new Worker('src/workers/nlp.worker.js') };

        // ... Sincronizzazione Port e Messaggi ...
        
        await audioProcessor.init(UI.audioSource.value, workerStore.vad.worker);
        setPowerBtn("■", "var(--term-warn)");
    } else {
        // Toggle Audio
        if (audioProcessor.isRecording) {
            audioProcessor.stop();
            setPowerBtn("▶", "var(--term-main)");
        } else {
            await audioProcessor.init(UI.audioSource.value, workerStore.vad.worker);
            setPowerBtn("■", "var(--term-warn)");
        }
    }
};

// Start UI Loops
initLanguages();
startRenderLoop(workerStore);