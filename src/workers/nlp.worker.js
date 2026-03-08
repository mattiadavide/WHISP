let currentLang = 'italian';

function levenshtein(a, b) {
    const m = []; 
    for (let i = 0; i <= b.length; i++) m[i] = [i]; 
    for (let j = 0; j <= a.length; j++) m[0][j] = j;
    
    for (let i = 1; i <= b.length; i++) { 
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i-1) === a.charAt(j-1)) m[i][j] = m[i-1][j-1];
            else m[i][j] = Math.min(m[i-1][j-1] + 1, Math.min(m[i][j-1] + 1, m[i-1][j] + 1));
        } 
    } 
    return m[b.length][a.length];
}

self.onmessage = (e) => {
    if (e.data.type === 'update_params') {
        currentLang = e.data.language; 
        return;
    }
    
    if (e.data.type === 'PROCESS_TEXT') {
        let { text, isLowConf, priorityPool, referenceDict } = e.data;
        if (!text) { 
            self.postMessage({ type: 'NLP_DONE', tokens: [] }); 
            return; 
        }

        text = text.replace(/\b([a-zA-ZÀ-ÿ\s']{2,50}?)\b(?:\s+\1\b){1,}/gi, '$1'); 
        text = text.replace(/([a-zA-ZÀ-ÿ']{2,})([\s,;.!?]+\1){3,}/gi, '$1');
        
        if (currentLang === 'italian') {
            text = text.replace(/\b(un)\s+po\b/gi, "$1 po'");
            text = text.replace(/\b(qual)\s+e\b/gi, "$1 è");
            text = text.replace(/\b(lo|dello|allo|sullo)\s+([bcdfghkmnpqrtvw]\w+)\b/gi, (m, p1, p2) => p1 + ' s' + p2);
        }

        const active = [...priorityPool, ...referenceDict];
        const tokens = text.split(/ +/).map((w) => {
            let original = w; 
            let healed = false; 
            let lowC = isLowConf;
            const match = original.match(/^([^a-zA-ZÀ-ÿ]*)([a-zA-ZÀ-ÿ]+)([^a-zA-ZÀ-ÿ]*)$/);
            
            if (match && /^[A-ZÀ-Ÿ]/.test(match[2])) {
                const [_, prefix, core, suffix] = match;
                const lower = core.toLowerCase();
                
                if (lower.length >= 4) {
                    let best = null, minDist = Infinity, exactMatch = false;
                    
                    active.forEach(ref => {
                        if (exactMatch) return; 
                        if (ref === lower) { exactMatch = true; minDist = 0; best = ref; return; }
                        if (Math.abs(ref.length - lower.length) > 2) return;
                        
                        let d = levenshtein(lower, ref);
                        if (d < minDist) { minDist = d; best = ref; }
                    });
                    
                    let threshold = lower.length >= 10 ? 2 : (lower.length >= 6 ? 1 : 0);
                    if (best && minDist > 0 && minDist <= threshold) {
                        original = prefix + best[0].toUpperCase() + best.slice(1) + suffix;
                        healed = true; lowC = false;
                    }
                }
            }
            return { text: original, isLowConf: lowC, healed };
        });

        self.postMessage({ type: 'NLP_DONE', tokens });
    }
};
