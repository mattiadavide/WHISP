let currentLang = 'italian';

// [FIX — BAG OF HALLUCINATIONS]: Known Whisper-specific hallucinated phrases
// Based on arXiv "Bag of Hallucinations" research and Microsoft ASR 2025 hallucination analysis.
// These strings appear in Whisper output when there is silence, noise, or very low-energy input.
const BOH_PATTERNS = [
    // Italian hallucinations
    /\bgra+zie(?:\s+a\s+tutti|\s+mille|\s+per\s+aver\s+(?:guardato|ascoltato|seguito))?\b/gi,
    /\bsottotitoli\s+(?:a\s+cura\s+di|creati\s+da|di)\b/gi,
    /\bquesta\s+[eè]\s+una\s+trascrizione\s+automatica\b/gi,
    /\bprossimamente\s+su\s+questi\s+schermi\b/gi,
    // Multilingual / universal
    /\[(?:MUSIC|SOUND|NOISE|Silence|silence|APPLAUSE|LAUGHTER|INAUDIBLE)\]/gi,
    /\bsubtitles?\s+by\b/gi,
    /\bthanks?\s+for\s+(?:watching|listening)\b/gi,
    /\blike\s+and\s+subscribe\b/gi,
    /[♪♫]{2,}/g,
    // Whisper generic empty-audio fills
    /\b(?:um+|uh+|eh+|hmm+)\s*\.\s*(?:um+|uh+|eh+|hmm+)\b/gi,
];

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
        let { text, isLowConf, priorityPool, referenceDict, wordConf } = e.data;
        if (!text) { 
            self.postMessage({ type: 'NLP_DONE', tokens: [] }); 
            return; 
        }

        // [FIX — BoH FILTER]: Strip known Whisper hallucination patterns before processing
        let filteredText = text;
        for (const pattern of BOH_PATTERNS) {
            filteredText = filteredText.replace(pattern, '');
        }
        filteredText = filteredText.trim();
        
        // If the entire segment was a hallucination, discard it
        if (!filteredText || filteredText.length < 2) {
            self.postMessage({ type: 'NLP_DONE', tokens: [] }); 
            return;
        }
        text = filteredText;

        // Dedup repetitions
        text = text.replace(/\b([a-zA-ZÀ-ÿ\s']{2,50}?)\b(?:\s+\1\b){1,}/gi, '$1'); 
        text = text.replace(/([a-zA-ZÀ-ÿ']{2,})([\s,;.!?]+\1){3,}/gi, '$1');
        
        if (currentLang === 'italian') {
            text = text.replace(/\b(un)\s+po\b/gi, "$1 po'");
            text = text.replace(/\b(qual)\s+e\b/gi, "$1 è");
            text = text.replace(/\b(lo|dello|allo|sullo)\s+([bcdfghkmnpqrtvw]\w+)\b/gi, (m, p1, p2) => p1 + ' s' + p2);

            // [FORMAT]: Italian discourse marker comma inference
            // Adds commas before conjunctions that typically introduce a clause
            text = text.replace(/\s+(però|però|quindi|invece|allora|dunque|oppure|eppure|infatti|cioè|ovvero)\s+/gi, (m, w) => `, ${w} `);
        }
        if (currentLang === 'english') {
            text = text.replace(/\s+(however|therefore|instead|actually|so|but|yet|indeed|namely)\s+/gi, (m, w) => `, ${w} `);
        }

        // [FORMAT]: Auto-capitalize first word of every segment
        text = text.replace(/^\s*([a-zA-ZÀ-ÿ])/, (m, c) => c.toUpperCase());

        // [FORMAT]: Auto-terminate with period if no terminal punctuation present
        const lastChar = text.trimEnd().slice(-1);
        if (lastChar && !'.!?,;:…'.includes(lastChar)) {
            text = text.trimEnd() + '.';
        }

        // Build a word-level confidence lookup from wordConf chunks (per-word confidence from Whisper)
        // This lets us mark only the specific uncertain words, not the entire segment
        const wordConfMap = new Map();
        if (wordConf && wordConf.length > 0) {
            for (const chunk of wordConf) {
                const cleanWord = (chunk.text || '').trim().toLowerCase().replace(/[^a-zA-ZÀ-ÿ']/g, '');
                if (cleanWord) wordConfMap.set(cleanWord, chunk.isLowConf);
            }
        }

        const active = [...priorityPool, ...referenceDict];
        const tokens = text.split(/ +/).map((w) => {
            let original = w; 
            let healed = false; 
            
            // [FIX — PER-WORD CONFIDENCE]: Use word-level confidence if available, else fall back to segment avg
            const cleanW = w.toLowerCase().replace(/[^a-zA-ZÀ-ÿ']/g, '');
            let lowC = wordConfMap.has(cleanW) ? wordConfMap.get(cleanW) : isLowConf;

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
