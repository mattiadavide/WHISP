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
    let currentCols = 5; 
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
            if (progress < 1) {
                requestAnimationFrame(animateTkn);
            }
        }
        animateTkn();
    });
    function loop() {
        if (renderState.needsRender) {
            const blendedProb = (renderState.prob * 0.4) + (renderState.asrProb * 0.6);
            if(UI.probVal) UI.probVal.innerText = blendedProb.toFixed(2);
            const rows = 4; // User requested 4 rows, equidistant
            
            // Revert back to using pure VAD probability as requested
            let probability = renderState.prob;
            if (isNaN(probability) || !isFinite(probability)) probability = 0;
            
            const minCols = 5;
            
            // Calculate maxCols dynamically based on the full available width of the footer gap
            let maxCols = 80; // Fallback
            if (UI.kittCenter && UI.kittCenter.parentElement) {
                // Fixed char width for equidistant grid (approx 8px)
                const charWidth = 8.0;
                
                // Leave a generous padding margin (40px) so it never touches or pushes the side panels.
                const availableWidth = UI.kittCenter.parentElement.clientWidth - 40;
                maxCols = Math.max(minCols, Math.floor(availableWidth / charWidth));
            }
            
            // Allow the probability to scale from minCols across the entire available container width
            const targetCols = minCols + (probability * (maxCols - minCols));
            currentCols += (targetCols - currentCols) * 0.15; 
            if (isNaN(currentCols) || !isFinite(currentCols)) currentCols = minCols; 
            let cols = Math.floor(currentCols);
            if (cols % 2 === 0) cols += 1; 
            if (UI.kittCenter) {
                // Opacity can still mildly react to pure VAD to flicker slightly
                const activeOpacity = (0.2 + (probability * 0.8)).toFixed(2);
                UI.kittCenter.style.setProperty('--vad-opacity', activeOpacity);
                const prevText = UI.kittCenter.innerText || "";
                let gridLines = [];
                // Four rows of small equidistant dots
                const activeDot  = '·';   
                const glowDot    = '˙';   
                const silentDot  = ' ';   
                for (let r = 0; r < rows; r++) {
                    let line = "";
                    for (let c = 0; c < cols; c++) {
                        const idx = r * (cols + 1) + c;
                        const isPrevActive = prevText[idx] === activeDot || prevText[idx] === glowDot;
                        if (Math.random() < probability) {
                            line += activeDot;
                        } else if (isPrevActive && Math.random() > 0.6) {
                            line += glowDot;  // fading residual after signal drops
                        } else {
                            line += silentDot;
                        }
                    }
                    gridLines.push(line);
                }
                UI.kittCenter.innerText = gridLines.join('\n');
            }
            if(UI.vadVal) UI.vadVal.innerText = renderState.prob.toFixed(2);
            if(UI.rmsVal) UI.rmsVal.innerText = (renderState.rms * 10).toFixed(2);
            renderState.needsRender = false;
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}