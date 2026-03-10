export const UI = {
    cliStatusText: document.getElementById('cli-status-text'), 
    zeitgeistLog: document.getElementById('zeitgeistLog'), 
    precisionSelect: document.getElementById('precisionSelect'), 
    languageSelect: document.getElementById('languageSelect'), 
    audioSource: document.getElementById('audioSource'), 
    domainSelect: document.getElementById('domainSelect'), 
    dictFileInput: document.getElementById('dictFileInput'),
    sysPowerBtn: document.getElementById('sysPowerBtn'), 
    output: document.getElementById('output'),
    probVal: document.getElementById('probVal'), 
    vadVal: document.getElementById('vadVal'),
    rmsVal: document.getElementById('rmsVal'),
    zgtVal: document.getElementById('zgtVal'),
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
export const cursorSpan = document.createElement('span');
cursorSpan.className = 'terminal-cursor';
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
export function setStatus(text, color) {
    if (!UI.cliStatusText) return;
    UI.cliStatusText.innerText = text; 
    if (color) UI.cliStatusText.style.color = color;
}
export function updateHarvestTable(lemma, type) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${lemma}</td><td>${type}</td><td style="color:var(--term-ok)">STORED</td>`;
    UI.harvestBody.prepend(tr);
}
export function setPowerBtn(text, color, disabled = undefined) {
    if (!UI.sysPowerBtn) return;
    UI.sysPowerBtn.innerText = text;
    if (color) UI.sysPowerBtn.style.color = color;
    if (disabled !== undefined) UI.sysPowerBtn.disabled = disabled;
}
export function resetMeters() {
    if(UI.kittCenter) {
        UI.kittCenter.innerText = "";
    }
}
export const renderState = {
    prob: 0,
    asrProb: 0,
    rms: 0,
    queue: 0,
    isSpeaking: false,
    needsRender: false
};
export function startRenderLoop(workerStore) {
    window.addEventListener('zeitgeist_sync_done', (e) => {
        if (!UI.zgtVal) return;
        const target = e.detail?.count || 0;
        const duration = 1500;
        const start = Date.now();
        function animateTkn() {
            const elapsed = Date.now() - start;
            const progress = Math.min(elapsed / duration, 1);
            const easeOut = 1 - Math.pow(1 - progress, 3);
            UI.zgtVal.innerText = Math.floor(easeOut * target);
            if (progress < 1) requestAnimationFrame(animateTkn);
        }
        animateTkn();
    });

    const logo = document.querySelector('.ascii-art');

    function loop() {
        if (renderState.needsRender) {
            const blendedProb = (renderState.prob * 0.4) + (renderState.asrProb * 0.6);
            if(UI.probVal) UI.probVal.innerText = blendedProb.toFixed(2);
            if(UI.vadVal) UI.vadVal.innerText = renderState.prob.toFixed(2);
            if(UI.rmsVal) UI.rmsVal.innerText = (renderState.rms * 10).toFixed(2);
            
            // Applica i valori alle variabili CSS del logo
            if (logo) {
                logo.style.setProperty('--vad-prob', renderState.prob || 0);
                logo.style.setProperty('--vad-rms', renderState.rms || 0);
            }

            renderState.needsRender = false;
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}