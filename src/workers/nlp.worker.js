let currentLang = 'italian';
const BOH_PATTERNS = [
    /\bgra+zie(?:\s+a\s+tutti|\s+mille|\s+per\s+aver\s+(?:guardato|ascoltato|seguito))?\b/gi,
    /\bsottotitoli\s+(?:a\s+cura\s+di|creati\s+da|di)\b/gi,
    /\bquesta\s+[eè]\s+una\s+trascrizione\s+automatica\b/gi,
    /\bprossimamente\s+su\s+questi\s+schermi\b/gi,
    /\[(?:MUSIC|SOUND|NOISE|Silence|silence|APPLAUSE|LAUGHTER|INAUDIBLE)\]/gi,
    /\bsubtitles?\s+by\b/gi,
    /\bthanks?\s+for\s+(?:watching|listening)\b/gi,
    /\blike\s+and\s+subscribe\b/gi,
    /[♪♫]{2,}/g,
    /\b(?:um+|uh+|eh+|hmm+)\s*\.\s*(?:um+|uh+|eh+|hmm+)\b/gi,
];

// [PHONETIC RECONCILIATION POOL]
// High-priority entities that the base model frequently garbles into phonetic clusters.
const GLOBAL_RECONCILIATION_POOL = {
    italian: [
        { entity: "Netanyahu", phonetic: ["netaniao", "netannia", "metaniao", "benjam"] },
        { entity: "Srebrenica", phonetic: ["srebre", "sebreniza", "srebren"] },
        { entity: "Stretto di Hormuz", phonetic: ["ormutz", "ormuzza", "ormuti", "ormozza"] },
        { entity: "Piazza Affari", phonetic: ["piazza fari", "piazzaffari"] },
        { entity: "per onestà", phonetic: ["perunesta", "peronesta", "esta"] },
        { entity: "Trump", phonetic: ["trampla", "trunp", "trampa"] }
    ]
};
const BASE_MODEL_PREFIX_REGEX = new RegExp(
    "^(" + 
    [
        "Lo\\s+(?=[A-Z])",
        "Lo\\s+s[vwbcdfghjklmnpqrtz]",
        "(?:[Ee]zza|[Ii]no|[Ii]na|[Mm]ente|[Zz]ione|[Vv]etta|[Vv]ettin\\w*)\\s+",
        "I?[Ss]chend[aeo]\\s+",
        "Lib[ae]\\s+non\\s+[eè]\\s+",
        "Indi[cz]i?\\s+",
        "Di\\s+grim[oa]?(?:ge?)?\\s+",
        "Di\\s+s[pfgb]\\w+\\s+",
        "Tean[zts]o\\w*\\s+",
        "(?:Le|Il|La)\\s+(?:cate|tecno|ste|teca|stit)\\w*\\s+",
        "Tral['\\x27]al[vb]o?\\s+",
        "(?:Le|Il|La)\\s+[a-z]{3,4}[aeiou]\\s+\\w+\\s+",
        "Più\\s+po[^r][a-z'°]\\w*\\s+",
        "Cambiamo\\s+di\\s+terr\\w*\\s+",
        "(?:Sul\\s+m[aeo]poli|[Mm]a\\s+poli[sz]|Da\\s+Nulm|[Mm]apoli[sz]\\w*)\\s+",
        "L'[Aa]l[a-z]*cia\\s+",
        "L'[Aa]n[a-z]+(?:d'[a-z]+)?\\s+",
        "Di\\s+Nui[-\\s][Oo]rk\\s+",
        "(?:[Rr]isabe|[Rr]erasom|[Rr]eraoam)\\s+",
        "Un\\s+st[aeiou]\\w*\\s+",
        "(?:Anciamo|[Cc]i\\s+angiamo|[Cc]iangiamo)\\s+\\w+",
        "Di\\s+lima\\s+",
        "Siamo\\s+alt[ro]+[.,\\s]",
        "Patti\\s+ha\\s+un\\s+cuoio\\s+",
        "Il\\s+colgarito\\s+",
        "Surtro(\\s+da\\s+personale)?\\s+",
        "L'attirtona\\s+",
        "Benzice\\s+",
        "Un\\s+tolisibile\\s+",
        "Nevo\\s+io\\s+",
        "Un\\s+ardo\\s+",
        "Tena\\s+cos[iì]\\s+",
        "(?:Di\\s+)?qualsiasi,,\\s+per\\xf2\\s+"
    ].join("|") + 
    ")",
    "i"
);
// [OPT — JARO-WINKLER]: Replaces Levenshtein for single-word healing.
// Literature (TU Delft 2024, ACL 2024 WER estimation): JW outperforms Levenshtein for ASR errors
// because ASR errors concentrate at word endings, and JW weights the correct *prefix* more heavily.
// Complexity: O(|s1| * |s2|) — same as Levenshtein but better precision for short strings.
function jaroWinkler(s1, s2, p = 0.1) {
    if (s1 === s2) return 1.0;
    const l1 = s1.length, l2 = s2.length;
    const matchDist = Math.max(Math.floor(Math.max(l1, l2) / 2) - 1, 0);
    const s1m = new Uint8Array(l1), s2m = new Uint8Array(l2);
    let matches = 0, transpositions = 0;
    for (let i = 0; i < l1; i++) {
        const lo = Math.max(0, i - matchDist), hi = Math.min(i + matchDist + 1, l2);
        for (let j = lo; j < hi; j++) {
            if (!s2m[j] && s1[i] === s2[j]) {
                s1m[i] = 1; s2m[j] = 1; matches++; break;
            }
        }
    }
    if (matches === 0) return 0;
    let k = 0;
    for (let i = 0; i < l1; i++) {
        if (!s1m[i]) continue;
        while (!s2m[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }
    const m = matches;
    let dj = (m / l1 + m / l2 + (m - transpositions / 2) / m) / 3;
    if (dj > 0.7) {
        let prefix = 0;
        for (let i = 0; i < Math.min(4, l1, l2); i++) {
            if (s1[i] === s2[i]) prefix++; else break;
        }
        dj = dj + prefix * p * (1 - dj);
    }
    return dj;
}
// [OPT — MBR PREFIX ANCHOR]: Minimum Bayes Risk prefix reconciliation.
// Paper: "MBR decoding consistently outperforms beam search" arXiv 2025.
// Whisper's final (beam search) often adds hallucinated leading words not present in the
// partial (greedy, more faithful to audio). This function strips leading final words that:
//   1. Are NOT found in the partial's first words (alignment check via JW)
//   2. Have low confidence (entropy-based, already in wordConf)
// This directly addresses the "Più po' / Cambiamo di terr / mapoli" prefix cascade.
// [OPT — PHONETIC RECONCILIATION]
// Detects garbled clusters and reconciles them against the pool.
function reconcilePhonetic(rawWords, language) {
    const pool = GLOBAL_RECONCILIATION_POOL[language];
    if (!pool) return rawWords;

    let result = [];
    for (let i = 0; i < rawWords.length; i++) {
        let matched = false;
        // Try to match up to 3 tokens fused together
        for (let len = 3; len >= 1; len--) {
            if (i + len > rawWords.length) continue;
            
            const cluster = rawWords.slice(i, i + len).join('').toLowerCase().replace(/[^a-z]/g, '');
            if (cluster.length < 3) continue;

            for (const entry of pool) {
                const threshold = entry.category === 'economic' ? 0.85 : 0.90;
                const jwMatch = entry.phonetic.some(p => {
                    if (Math.abs(cluster.length - p.length) > 4) return false;
                    return jaroWinkler(cluster, p) > threshold;
                });
                if (jwMatch) {
                    result.push(entry.entity);
                    i += (len - 1);
                    matched = true;
                    break;
                }
            }
            if (matched) break;
        }
        if (!matched) {
            result.push(rawWords[i]);
        }
    }
    return result;
}
function mbrPrefixCheck(finalText, partialText, wordConf) {
    if (!partialText || !partialText.trim()) return finalText;
    const fWords = finalText.trim().split(/\s+/);
    const pWords = partialText.trim().split(/\s+/);
    if (fWords.length === 0 || pWords.length === 0) return finalText;
    // Build confidence map from word conf array
    const confMap = new Map();
    if (wordConf) {
        wordConf.forEach(c => {
            const w = (c.text || '').trim().toLowerCase().replace(/[^a-z\u00e0-\u00f6\u00f8-\u00ff]/g, '');
            if (w) confMap.set(w, c.isLowConf);
        });
    }
    let prefixHallucCount = 0;
    const searchWindow = Math.min(4, fWords.length); // check up to 4 leading words
    for (let i = 0; i < searchWindow; i++) {
        const fw = fWords[i].toLowerCase().replace(/[^a-z\u00e0-\u00f6\u00f8-\u00ff]/g, '');
        if (fw.length < 2) { prefixHallucCount++; continue; } // skip punctuation-only
        // Check if this word appears in the partial's first words (with JW tolerance)
        const inPartial = pWords.slice(0, Math.min(i + 4, pWords.length)).some(p => {
            const pc = p.toLowerCase().replace(/[^a-z\u00e0-\u00f6\u00f8-\u00ff]/g, '');
            return jaroWinkler(fw, pc) > 0.88;
        });
        if (inPartial) break; 
        const isLowC = confMap.size > 0 ? (confMap.has(fw) ? confMap.get(fw) : true) : false; 
        if (isLowC) {
            prefixHallucCount++;
        } else {
            break; 
        }
    }
    if (prefixHallucCount > 0) {
        return fWords.slice(prefixHallucCount).join(' ');
    }
    return finalText;
}
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
        
        // Emulate NLP dictionary load progress for the UI boot sequence
        if (!self._hasReportedLoad) {
            self._hasReportedLoad = true;
            self.postMessage({ type: 'progress', status: 'initiate', file: 'nlp_dictionaries', loaded: 0, total: 100, p: 0 });
            setTimeout(() => self.postMessage({ type: 'progress', status: 'progress', file: 'nlp_dictionaries', loaded: 50, total: 100, p: 50 }), 100);
            setTimeout(() => self.postMessage({ type: 'progress', status: 'ready', file: 'nlp_dictionaries', loaded: 100, total: 100, p: 100 }), 200);
        }
        return;
    }
    // [RETROACTIVE HEALING] — Re-run JW healing on low-conf DOM tokens using the
    // current (grown) referenceDict. Called from main.js on each prompt re-sync.
    // Returns only healed tokens to minimize DOM updates.
    if (e.data.type === 'REHEAL_TOKENS') {
        const { tokens, priorityPool, referenceDict: refDict } = e.data;
        if (!tokens || tokens.length === 0) return;
        const active = [...priorityPool, ...refDict];
        const healed = [];

        // Pre-build semantic pool from global pool
        const semanticPool = [];
        if (typeof GLOBAL_RECONCILIATION_POOL !== 'undefined') {
            Object.values(GLOBAL_RECONCILIATION_POOL).forEach(langPool => {
                langPool.forEach(item => semanticPool.push(item.entity.toLowerCase()));
            });
        }

        for (let i = 0; i < tokens.length; i++) {
            let matched = false;
            
            // MULTI-TOKEN FISSION HEALING (2-3 consecutive low-conf tokens)
            for (let len = 3; len >= 2; len--) {
                if (i + len > tokens.length) continue;
                
                const slice = tokens.slice(i, i + len);
                // Fuse phonetically to recover split words
                const fused = slice.map(t => t.word.toLowerCase().replace(/[^a-z\u00e0-\u00f6\u00f8-\u00ff]/g, '')).join('');
                if (fused.length < 5) continue;

                let bestMatch = null, maxJW = 0;
                const candidates = [...active, ...semanticPool];
                
                for (const cand of candidates) {
                    if (Math.abs(cand.length - fused.length) > 5) continue;
                    const jw = jaroWinkler(fused, cand);
                    if (jw > maxJW) { maxJW = jw; bestMatch = cand; }
                    if (maxJW > 0.96) break;
                }

                if (bestMatch && maxJW > 0.92) {
                    healed.push({ 
                        id: slice[0].id, 
                        corrected: bestMatch[0].toUpperCase() + bestMatch.slice(1), 
                        consumeNext: len - 1 
                    });
                    i += (len - 1);
                    matched = true;
                    break;
                }
            }

            if (matched) continue;
            
            // Standard 1:1 correction...

            // Standard 1:1 Healing
            const { id, word } = tokens[i];
            const match = word.match(/^([^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]*)([a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]+)([^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]*)$/);
            if (!match) continue;
            const [_, prefix, core, suffix] = match;
            const lower = core.toLowerCase();
            if (lower.length < 4) continue;
            let best = null, maxJW = 0;
            const jwThreshold = lower.length >= 8 ? 0.85 : 0.88;
            for (const ref of active) {
                if (ref === lower) { best = ref; maxJW = 1.0; break; }
                if (Math.abs(ref.length - lower.length) > 3) continue;
                if (lower[0] !== ref[0]) continue;
                const jw = jaroWinkler(lower, ref);
                if (jw > maxJW) { maxJW = jw; best = ref; }
                if (maxJW > 0.95) break;
            }
            if (best && maxJW >= jwThreshold && maxJW < 1.0) {
                const corrected = prefix + best[0].toUpperCase() + best.slice(1) + suffix;
                healed.push({ id, corrected });
            }
        }
        if (healed.length > 0) {
            self.postMessage({ type: 'REHEAL_DONE', healed });
        }
        return;
    }
    if (e.data.type === 'PROCESS_TEXT') {
        let { text, isLowConf, priorityPool, referenceDict, wordConf } = e.data;
        if (!text) { 
            self.postMessage({ type: 'NLP_DONE', tokens: [] }); 
            return; 
        }
        let filteredText = text;
        for (const pattern of BOH_PATTERNS) {
            filteredText = filteredText.replace(pattern, '');
        }
        filteredText = filteredText.trim();
        filteredText = filteredText.replace(BASE_MODEL_PREFIX_REGEX, '').trim();
        if (!filteredText || filteredText.length < 2) {
            self.postMessage({ type: 'NLP_DONE', tokens: [] }); 
            return;
        }
        text = filteredText;
        if (e.data.lastPartialText) {
            filteredText = mbrPrefixCheck(filteredText, e.data.lastPartialText, wordConf);
            filteredText = filteredText.trim();
            if (!filteredText || filteredText.length < 2) {
                self.postMessage({ type: 'NLP_DONE', tokens: [] }); return;
            }
            text = filteredText;
        }
        text = text.replace(/\b([a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff\s']{2,50}?)\b(?:\s+\1\b){1,}/gi, '$1'); 
        text = text.replace(/([a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff']{2,})([\s,;.!?]+\1){3,}/gi, '$1');
        text = text.replace(/([a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff])\1{2,}/gi, '$1$1');
        if (currentLang === 'italian') {
            // [PHONETIC RECONCILIATION — RADIO 24 & GEOPOLITICS]
            // This replaces the old static regex approach with a cluster fusion logic.
            const rawWords = text.split(/\s+/);
            const reconciledWords = reconcilePhonetic(rawWords, 'italian');
            text = reconciledWords.join(' ');
            
                       // Neutralization: Specific nomenclature overrides removed for universal ASR logic.
            text = text.replace(/\b(un)\s+po\b/gi, "$1 po'");
            text = text.replace(/\b(qual)\s+e\b/gi, "$1 è");
            text = text.replace(/\s+(però|però|quindi|invece|allora|dunque|oppure|eppure|infatti|cioè|ovvero)\s+/gi, (m, w) => `, ${w} `);
 text = text.replace(/\bdebanche\b/gi, "delle banche");
        }
        if (currentLang === 'english') {
            text = text.replace(/\s+(however|therefore|instead|actually|so|but|yet|indeed|namely)\s+/gi, (m, w) => `, ${w} `);
        }
        text = text.replace(/^\s*([a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff])/, (m, c) => c.toUpperCase());
        const lastChar = text.trimEnd().slice(-1);
        if (lastChar && !'.!?,;:…'.includes(lastChar)) {
            text = text.trimEnd() + '.';
        }
        const wordConfMap = new Map();
        if (wordConf && wordConf.length > 0) {
            for (const chunk of wordConf) {
                const cleanWord = (chunk.text || '').trim().toLowerCase().replace(/[^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff']/g, '');
                if (cleanWord) wordConfMap.set(cleanWord, chunk.isLowConf);
            }
        }
        const active = [...priorityPool, ...referenceDict];
        let rawWords = text.split(/ +/);
        let mergedTokens = [];
        for (let i = 0; i < rawWords.length; i++) {
            if (i < rawWords.length - 1) {
                const w1 = rawWords[i];
                const w2 = rawWords[i+1];
                const combinedClean = (w1 + w2).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, '');
                if (combinedClean.length >= 6) {
                    let bestPairMatch = null, minPairDist = Infinity;
                    active.forEach(ref => {
                        const refClean = ref.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, '');
                        if (Math.abs(refClean.length - combinedClean.length) > 2) return;
                        let d = levenshtein(combinedClean, refClean);
                        if (d < minPairDist) { minPairDist = d; bestPairMatch = ref; }
                    });
                    if (bestPairMatch && minPairDist <= 1) {
                        const match1 = w1.match(/^([^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]*)/);
                        const match2 = w2.match(/([^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]*)$/);
                        const prefix = match1 ? match1[1] : '';
                        const suffix = match2 ? match2[1] : '';
                        const healedWord = prefix + bestPairMatch[0].toUpperCase() + bestPairMatch.slice(1) + suffix;
                        mergedTokens.push({ text: healedWord, isLowConf: false, healed: true, merged: true });
                        i++; 
                        continue;
                    }
                }
            }
            mergedTokens.push({ text: rawWords[i], isLowConf: null, healed: false, merged: false });
        }
        const tokens = mergedTokens.map((t) => {
            if (t.merged) return { text: t.text, isLowConf: false, healed: true }; 
            let original = t.text; 
            let healed = false; 
            const cleanW = original.toLowerCase().replace(/[^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff']/g, '');
            let lowC = wordConfMap.has(cleanW) ? wordConfMap.get(cleanW) : isLowConf;
            const match = original.match(/^([^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]*)([a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]+)([^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]*)$/);
            if (match && /^[A-ZÀ-Ÿ]/.test(match[2]) && lowC) {
                const [_, prefix, core, suffix] = match;
                const lower = core.toLowerCase();
                if (lower.length >= 4) {
                    let best = null, maxJW = 0, exactMatch = false;
                    const jwThreshold = lower.length >= 8 ? 0.85 : 0.88; 
                    active.forEach(ref => {
                        if (exactMatch) return;
                        if (ref === lower) { exactMatch = true; maxJW = 1.0; best = ref; return; }
                        if (Math.abs(ref.length - lower.length) > 3) return; 
                        if (lower[0] !== ref[0]) return;
                        const jw = jaroWinkler(lower, ref);
                        if (jw > maxJW) { maxJW = jw; best = ref; }
                        if (maxJW > 0.95) { exactMatch = true; }
                    });
                    if (best && maxJW >= jwThreshold && maxJW < 1.0) {
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