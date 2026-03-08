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
    volAscii: document.getElementById('rmsMeter'), 
    vadAscii: document.getElementById('vadMeter'), 
    probVal: document.getElementById('probVal'), 
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
    if(UI.volAscii) UI.volAscii.innerText = '[--------------------]'; 
    if(UI.vadAscii) UI.vadAscii.innerText = '[--------------------]';
}

// [APEX TUNING]: Render Loop disaccoppiato tramite requestAnimationFrame 
// per impedire che i messaggi IPC dei WebWorker blocchino il main thread.
export const renderState = {
    prob: 0,
    rms: 0,
    isSpeaking: false,
    needsRender: false
};

export function startRenderLoop() {
    function loop() {
        if (renderState.needsRender) {
            if(UI.probVal) UI.probVal.innerText = renderState.prob.toFixed(2);
            let b = Math.round(renderState.prob * 20); 
            if(UI.vadAscii) UI.vadAscii.innerText = '[' + '#'.repeat(b) + '-'.repeat(20 - b) + ']';
            let volLevel = Math.min(20, Math.floor(renderState.rms * 150)); 
            if(UI.volAscii) UI.volAscii.innerText = '[' + '#'.repeat(volLevel) + '-'.repeat(20 - volLevel) + ']';
            renderState.needsRender = false;
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}
