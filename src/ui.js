export const UI = {
    status: document.getElementById('status'), 
    progressText: document.getElementById('progress-text'), 
    zeitgeistLog: document.getElementById('zeitgeist-log'), 
    progressContainer: document.getElementById('progress-container'), 
    asciiBar: document.getElementById('ascii-bar'), 
    precisionSelect: document.getElementById('precisionSelect'), 
    languageSelect: document.getElementById('languageSelect'), 
    audioSource: document.getElementById('audioSource'), 
    domainSelect: document.getElementById('domainSelect'), 
    dictFileInput: document.getElementById('dictFileInput'),
    sysPowerBtn: document.getElementById('sysPowerBtn'), 
    output: document.getElementById('output'),
    vadLed: document.getElementById('vadLed'), 
    volAscii: document.getElementById('volAscii'), 
    vadAscii: document.getElementById('vadAscii'), 
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
    UI.status.innerText = text; 
    if (color) UI.status.style.color = color;
}

export function setPowerBtn(text, color, disabled = undefined) {
    UI.sysPowerBtn.innerText = text;
    if (color) UI.sysPowerBtn.style.color = color;
    if (disabled !== undefined) UI.sysPowerBtn.disabled = disabled;
}

export function resetMeters() {
    UI.vadLed.classList.remove('active');
    UI.volAscii.innerText = '[--------------------]'; 
    UI.vadAscii.innerText = '[--------------------]';
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
            UI.probVal.innerText = "PROB: " + renderState.prob.toFixed(2);
            let b = Math.round(renderState.prob * 20); 
            UI.vadAscii.innerText = '[' + '#'.repeat(b) + '-'.repeat(20 - b) + ']';
            UI.vadLed.classList.toggle('active', renderState.isSpeaking);
            let volLevel = Math.min(20, Math.floor(renderState.rms * 150)); 
            UI.volAscii.innerText = '[' + '#'.repeat(volLevel) + '-'.repeat(20 - volLevel) + ']';
            renderState.needsRender = false;
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}
