export const UI = {
    status: document.getElementById('sysStatus'), 
    zeitgeistLog: document.getElementById('zeitgeistLog'), 
    precisionSelect: document.getElementById('precisionSelect'), 
    languageSelect: document.getElementById('languageSelect'), 
    audioSource: document.getElementById('audioSource'), 
    domainSelect: document.getElementById('domainSelect'), 
    dictFileInput: document.getElementById('dictFileInput'),
    sysPowerBtn: document.getElementById('sysPowerBtn'), 
    output: document.getElementById('output'),
    kittCenter: document.getElementById('kittCenter'),
    probVal: document.getElementById('probVal'), 
    vadVal: document.getElementById('vadVal'),
    rmsVal: document.getElementById('rmsVal'),
    clearBtn: document.getElementById('clearBtn'), 
    copyBtn: document.getElementById('copyBtn'),
    popup: document.getElementById('word-popup'), 
    editInput: document.getElementById('edit-word-input'), 
    confirmBtn: document.getElementById('confirm-word-btn'), 
    toggleHarvestBtn: document.getElementById('toggleHarvestBtn'), 
    harvestPanel: document.getElementById('harvest-panel'), 
    closeHarvestBtn: document.getElementById('closeHarvestBtn'),
    exportBtn: document.getElementById('exportBtn'), 
    harvestBody: document.getElementById('harvest-body')
};

export const interimSpan = document.createElement('span'); 
interimSpan.className = 'interim-text';

export function initLanguages() {
    const langs = { "italian": "ITA", "english": "ENG", "spanish": "ESP", "french": "FRA", "german": "GER" }; 
    UI.languageSelect.innerHTML = "";
    for (const [val, label] of Object.entries(langs)) { 
        const opt = document.createElement("option"); 
        opt.value = val; 
        opt.text = label; 
        UI.languageSelect.appendChild(opt); 
    }
}

export function updateHarvestTable(lemma, type) {
    const tr = document.createElement('tr'); 
    tr.innerHTML = `<td>${lemma}</td><td>${type}</td><td style="color:var(--term-ok)">STORED</td>`; 
    UI.harvestBody.prepend(tr);
}

export function setStatus(text, color) {
    if (!UI.status) return;
    UI.status.innerText = text; 
    if (color) UI.status.style.color = color;
}

export function setPowerBtn(text, color, disabled = undefined) {
    if (!UI.sysPowerBtn) return;
    UI.sysPowerBtn.innerText = text;
    if (color) UI.sysPowerBtn.style.color = color;
    if (disabled !== undefined) UI.sysPowerBtn.disabled = disabled;
}

export function resetMeters() {
    const empty = '.'.repeat(25);
    if(UI.kittCenter) UI.kittCenter.innerText = empty;
}

// [APEX TUNING]: Render Loop disaccoppiato tramite requestAnimationFrame 
// per impedire che i messaggi IPC dei WebWorker blocchino il main thread.
export const renderState = {
    prob: 0,
    asrProb: 0,
    rms: 0,
    isSpeaking: false,
    needsRender: false
};

export function startRenderLoop() {
    function loop() {
        if (renderState.needsRender) {
            if(UI.probVal) UI.probVal.innerText = renderState.asrProb.toFixed(2);
            
            // Single Thin Continuous Line Logic (Dynamically Lengthening Dots)
            const maxDots = 12;
            
            // Reactivity: Combine Neural VAD probability (speech gating) with true physical RMS bounce (multiplied for visibility)
            // We subtract a small noise floor (-0.1) so background hum drops the meter to exactly zero dots.
            let rawVol = Math.max(0, Math.min(1, (renderState.prob * 0.8) + (renderState.rms * 5.0) - 0.1)); 

            let dotCount = Math.floor(rawVol * maxDots); // dots per side
            
            // Generate a symmetric string: [dots] + [center char] + [dots]
            // We use standard dots for the line.
            let sideDots = '.'.repeat(Math.max(0, dotCount));
            // Let's ensure there's always at least one center dot
            let dotString = sideDots + '.' + sideDots;

            if(UI.kittCenter) UI.kittCenter.innerText = dotString;

            // [SUPERCAR INTENSITY]: Intensity drives brightness and glow
            // Driven heavily by rawVol to "light up" fast
            const intensity = 0.2 + (rawVol * 2.0);
            if(UI.kittCenter) UI.kittCenter.style.setProperty('--kitt-intensity', intensity);
            
            // Text-based metrics in the 2x2 grid
            if(UI.vadVal) UI.vadVal.innerText = renderState.prob.toFixed(2);
            if(UI.rmsVal) UI.rmsVal.innerText = (renderState.rms * 10).toFixed(2);
            
            renderState.needsRender = false;
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}
