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

    window.addEventListener('tkn_live_update', (e) => {
        if (UI.zgtVal) {
            UI.zgtVal.innerText = e.detail.count;
            UI.zgtVal.style.color = 'var(--term-ok)';
            setTimeout(() => UI.zgtVal.style.color = '', 300);
        }
    });

    const logo = document.querySelector('.ascii-art');
    let particles = [];
    const fonts = ['Impact', 'Georgia', 'Arial', 'Courier', 'Verdana', 'monospace'];
    let smoothedIntensity = 0;
    let lastGlitchTime = 0;

    function loop() {
        const now = Date.now();
        const currentRms = renderState.rms || 0;
        const speechProb = renderState.prob || 0;
        
        if (logo) {
            if (particles.length === 0) particles = Array.from(logo.querySelectorAll('.logo-particle'));

            // 1. GLITCH TIPOGRAFICO: Se c'è parlato, cambia font a un gruppo di particelle
            if (speechProb > 0.4 && now - lastGlitchTime > 40) {
                lastGlitchTime = now;
                const affected = Math.floor(particles.length * (0.2 + speechProb * 0.3));
                for(let i=0; i<affected; i++) {
                    const p = particles[Math.floor(Math.random() * particles.length)];
                    p.style.fontFamily = fonts[Math.floor(Math.random() * fonts.length)];
                    setTimeout(() => p.style.fontFamily = '', 70);
                }
            }

            // 2. RAREFAZIONE FISICA: Più c'è parlato, più i pixel "evaporano"
            // Usiamo un mix di RMS (volume) e speechProb (certezza del parlato)
            let targetIntensity = (currentRms * 25) + (speechProb * 0.5);
            targetIntensity = Math.min(targetIntensity, 1.4);

            if (targetIntensity > smoothedIntensity) {
                smoothedIntensity = targetIntensity;
            } else {
                smoothedIntensity += (targetIntensity - smoothedIntensity) * 0.15;
            }
            
            if (currentRms < 0.001 && speechProb < 0.1) smoothedIntensity *= 0.8;

            logo.style.setProperty('--glitch-intensity', smoothedIntensity.toFixed(3));
        }
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}