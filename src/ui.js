import { FRAME_BOOT, FRAME_READY, FRAME_WHISP, FRAME_SHH, FRAME_TALK, FRAME_MUSIC, FRAME_CHATTING } from './logo_header.js';

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
    harvestBody: document.getElementById('harvest-body'),
    sigRms: document.getElementById('sigRms'),
    sigVad: document.getElementById('sigVad')
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
    
    // Industrial Precision Toggle
    if (text === "■") UI.sysPowerBtn.classList.add('active');
    else if (text === "▶") UI.sysPowerBtn.classList.remove('active');
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


export function setLayoutScenario(state) {
    const container = document.getElementById('app-container');
    if (!container) return;
    container.classList.remove('BOOT', 'READY', 'REC');
    if (state) container.classList.add(state);
}

const shadingChars = ['█', '▓', '▒', '░', '+', '*'];
const gridRows = 6;
const gridCols = 76;
let particles = [];

export function initParticlePool() {
    const logo = document.querySelector('.ascii-art');
    if (!logo) return;
    logo.innerHTML = '';
    particles = [];
    // 456 particles (76x6 grid size)
    for (let i = 0; i < 456; i++) {
        const p = document.createElement('span');
        p.className = 'logo-particle';
        
        // Initial pool position at center of logo area (228px = 456px / 2)
        p.style.left = `228px`;
        p.style.top = `18px`;
        p.style.opacity = "0";
        
        // Kinetic Disorder: Random transition delay for swarm effect
        p.style.transitionDelay = (Math.random() * 0.2).toFixed(2) + 's';
        
        // Narrower range for maximum intelligibility (Ferrous oscillation)
        const rx = (Math.random() - 0.5) * 8;
        const ry = (Math.random() - 0.5) * 4;
        p.style.setProperty('--rx', `${rx}px`);
        p.style.setProperty('--ry', `${ry}px`);

        logo.appendChild(p);
        particles.push(p);
    }
}

export function morphToFrame(frame) {
    if (particles.length === 0) return;
    const lines = frame.replace(/^\n/, '').split('\n');
    const targets = [];
    
    for (let r = 0; r < gridRows; r++) {
        const line = lines[r] || "";
        for (let c = 0; c < gridCols; c++) {
            const char = line[c] || " ";
            if (char !== " " && char !== "") {
                targets.push({ x: c * 6, y: r * 6, char: char });
            }
        }
    }

    const availableParticles = [...particles].sort(() => Math.random() - 0.5);

    availableParticles.forEach((p, idx) => {
        const target = targets[idx];
        if (target) {
            p.style.left = `${target.x}px`;
            p.style.top = `${target.y}px`;
            p.innerText = target.char;
            p.dataset.origChar = target.char; // Memoria del frame originale
            p.style.opacity = "1";
            p.dataset.active = "true";
        } else {
            p.dataset.active = "false";
            p.style.opacity = "0";
        }
    });
}

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

    initParticlePool();
    let currentFrameType = '';
    let voiceHoldUntil = 0;
    let prevRms = 0;
    let glitchFrames = 0;

    function loop() {
        const container = document.getElementById('app-container');
        if (!container) return requestAnimationFrame(loop);

        const glitchSet = ['@', '#', '$', '%', '&', '*', '█', '▓', '▒'];
        const colorSet = ['var(--term-main)', 'var(--term-warn)', 'var(--term-accent)', 'var(--term-dim)'];
        
        let targetFrame = FRAME_SHH;
        let type = 'SHH'; 
        let jitterMult = 6;

        const now = Date.now();
        const currentRms = renderState.rms || 0;

        if (currentRms - prevRms > 0.025) {
            glitchFrames = 4;
        }
        prevRms = currentRms;

        if (container.classList.contains('BOOT')) {
            targetFrame = FRAME_BOOT;
            type = 'BOOT';
        } else if (container.classList.contains('REC')) {
            const isSpeaking = renderState.prob > 0.40;
            if (isSpeaking) {
                voiceHoldUntil = now + 1200; 
                targetFrame = FRAME_WHISP;
                type = 'WHISP';
                jitterMult = 0; 
            } else {
                if (now > voiceHoldUntil) {
                    targetFrame = FRAME_SHH;
                    type = 'SHH';
                } else {
                    targetFrame = FRAME_WHISP;
                    type = 'WHISP';
                    jitterMult = 0;
                }
            }
        }

        if (type !== currentFrameType) {
            currentFrameType = type;
            morphToFrame(targetFrame);
        }

        const intensity = Math.min(currentRms * jitterMult, 1.2);
        container.style.setProperty('--glitch-intensity', intensity.toFixed(3));

        const currentGlitch = glitchFrames > 0;
        if (glitchFrames > 0) glitchFrames--;

        particles.forEach(p => {
            if (p.dataset.active === "true") {
                if (currentGlitch && Math.random() < 0.35) {
                    p.innerText = glitchSet[Math.floor(Math.random() * glitchSet.length)];
                } else if (p.innerText !== p.dataset.origChar && Math.random() < 0.15) {
                    p.innerText = p.dataset.origChar;
                }

                if (currentRms > 0.01 && Math.random() < (currentRms * 6)) {
                    p.style.color = colorSet[Math.floor(Math.random() * colorSet.length)];
                    p.style.opacity = Math.min(0.4 + (currentRms * 8) + Math.random() * 0.3, 1).toFixed(2);
                } else {
                    p.style.color = 'var(--term-main)';
                    p.style.opacity = Math.max(0.3, 1 - (Math.random() * 0.3)).toFixed(2);
                }
            }
        });

        if (UI.sigRms) UI.sigRms.innerText = currentRms.toFixed(3);
        if (UI.sigVad) UI.sigVad.innerText = (renderState.prob || 0).toFixed(3);

        const borderIntensity = Math.min(currentRms * 20, 10);
        document.documentElement.style.setProperty('--border-glow', `${borderIntensity}px`);

        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
}