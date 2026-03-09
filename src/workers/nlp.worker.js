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

// [FIX — BASE MODEL SEGMENT-PREFIX HALLUCINATIONS]: The base/tiny models frequently hallucinate
// a short connective prefix at the **start** of a segment. Common examples from Italian:
//   "Lo " (e.g. "Lo svedremo" → "Vedremo"), "Lo svi", "Lo Schermi", "Ischenda", "Libe non è"
// These are NOT real words — they are the model trying to "remember" a fictional preceding sentence.
// We strip them only from the START of the segment to avoid destroying valid mid-sentence use.
const BASE_MODEL_PREFIX_PATTERNS = [
    // "Lo" / "La" / "Le" / "Li" used as a mantra prefix when the model has no real context
    /^Lo\s+(?=[A-Z])/,          // "Lo Schermi", "Lo Si" — Lo + Capitalized word is always wrong
    /^Lo\s+s[vwbcdfghjklmnpqrtz]/i, // "Lo svi", "Lo sve", "Lo sca" — Lo + consonant cluster is noise
    // "Ezza affidabilità" — Italian word-suffix fragment leaking from previous segment boundary
    // These are word-endings (-ezza, -ino, -ina, -ione, -mente stripped of their root) that appear alone.
    /^(?:[Ee]zza|[Ii]no|[Ii]na|[Mm]ente|[Zz]ione|[Vv]etta|[Vv]ettin\w*)\s+/,
    // "Ischenda", "Libe non è" etc. — garbage tokens that start segments from base model
    /^I?[Ss]chend[aeo]\s+/i,
    /^Lib[ae]\s+non\s+[eè]\s+/i,
    // "Indici in sacco", "Di grimo", "Di grimoge" — base model invents discourse starters from nowhere
    /^Indi[cz]i?\s+/i,
    /^Di\s+grim[oa]?(?:ge?)?\s+/i,  // "Di grimo", "Di grimoge"
    /^Di\s+s[pfgb]\w+\s+/i,           // "Di sfogli", "Di spoli" — Di + s + consonant-cluster garbage
    /^Tean[zts]o\w*\s+/i,              // "Teanzo" — tiny model specific garbage token
    // "Le cate", "Il tecno", "Tral'alvo" — article/preposition + non-existent Italian word
    /^(?:Le|Il|La)\s+(?:cate|tecno|ste|teca|stit)\w*\s+/i,
    /^Tral['\x27]al[vb]o?\s+/i,   // "Tral'alvo", "Tral'algo" — garbled "Tra l'altro"
    // Generic: article + 3-4 char root that is not a real Italian word
    /^(?:Le|Il|La)\s+[a-z]{3,4}[aeiou]\s+\w+\s+/i,
    // "Più po' salile", "Più postando", "Più poesanti" — hallucinated "Più po" prefix that the
    // base model generates when borrowing from previous segments ending in comparative forms.
    /^Più\s+po[^r][a-z'°]\w*\s+/i,  // excludes "Più porta..." which is valid Italian
    // "Cambiamo di terr...", "Cambiamo di terrenza" — hallucinated sport segment transition
    /^Cambiamo\s+di\s+terr\w*\s+/i,
    // "Sul mapolizz...", "Ma polizia mi...", "Da Nulmapoli" — garbled Napoli prefix from football context
    /^(?:Sul\s+m[aeo]poli|[Mm]a\s+poli[sz]|Da\s+Nulm|[Mm]apoli[sz]\w*)\s+/i,
    // "L'Alancia", "L'ancetto d'anido" — hallucinated L' + garbled word
    /^L'[Aa]l[a-z]*cia\s+/i,
    /^L'[Aa]n[a-z]+(?:d'[a-z]+)?\s+/i,
    // "Di Nui-Ork" → garbled "New York" (remove mangled geographical prefix)
    /^Di\s+Nui[-\s][Oo]rk\s+/i,
    // "risabe a" / "reraoma" — typical base model garbled filler fragments
    /^(?:[Rr]isabe|[Rr]erasom|[Rr]eraoam)\s+/i,
    // "Un stall", "Un stagio", "Un stalato" — "Un" + non-Italian word starting with st+vowel
    // CONSERVATIVE: only st+vowel combos (stall, stagio, stalato are not Italian words)
    // "Un mistero" / "Un'immagine" are valid and NOT caught by this
    /^Un\s+st[aeiou]\w*\s+/i,
    // "Anciamo al tuo", "Ci angiamo alto", "Diciamo al tuo" — garbled discourse transitions
    // These borrow from audio fragments of "andiamo all'audio" / "Diciamo che" misheard
    /^(?:Anciamo|[Cc]i\s+angiamo|[Cc]iangiamo)\s+\w+/i,
    // "Di lima parte più poe" — fragment of garbled previous text leaking as segment opener
    /^Di\s+lima\s+/i,
    // "Siamo altro" used as a sentence-starting filler (borrowed from mid-sentence "siamo in")
    /^Siamo\s+alt[ro]+[.,\s]/i,
];

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
            if (s2m[j] || s1[i] !== s2[j]) continue;
            s1m[i] = s2m[j] = 1; matches++; break;
        }
    }
    if (!matches) return 0;
    let k = 0;
    for (let i = 0; i < l1; i++) {
        if (!s1m[i]) continue;
        while (!s2m[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }
    const jaro = (matches/l1 + matches/l2 + (matches - transpositions/2)/matches) / 3;
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(l1, l2)); i++) {
        if (s1[i] === s2[i]) prefix++; else break;
    }
    return jaro + prefix * p * (1 - jaro);
}

// [OPT — MBR PREFIX ANCHOR]: Minimum Bayes Risk prefix reconciliation.
// Paper: "MBR decoding consistently outperforms beam search" arXiv 2025.
// Whisper's final (beam search) often adds hallucinated leading words not present in the
// partial (greedy, more faithful to audio). This function strips leading final words that:
//   1. Are NOT found in the partial's first words (alignment check via JW)
//   2. Have low confidence (entropy-based, already in wordConf)
// This directly addresses the "Più po' / Cambiamo di terr / mapoli" prefix cascade.
function mbrPrefixCheck(finalText, partialText, wordConf) {
    if (!partialText || !partialText.trim()) return finalText;
    const fWords = finalText.trim().split(/\s+/);
    const pWords = partialText.trim().split(/\s+/);
    if (fWords.length === 0 || pWords.length === 0) return finalText;

    // Build confidence map from word conf array
    const confMap = new Map();
    if (wordConf) {
        wordConf.forEach(c => {
            const w = (c.text || '').trim().toLowerCase().replace(/[^a-zà-ÿ]/g, '');
            if (w) confMap.set(w, c.isLowConf);
        });
    }

    let prefixHallucCount = 0;
    const searchWindow = Math.min(4, fWords.length); // check up to 4 leading words
    for (let i = 0; i < searchWindow; i++) {
        const fw = fWords[i].toLowerCase().replace(/[^a-zà-ÿ]/g, '');
        if (fw.length < 2) { prefixHallucCount++; continue; } // skip punctuation-only

        // Check if this word appears in the partial's first words (with JW tolerance)
        const inPartial = pWords.slice(0, Math.min(i + 4, pWords.length)).some(p => {
            const pc = p.toLowerCase().replace(/[^a-zà-ÿ]/g, '');
            return jaroWinkler(fw, pc) > 0.88;
        });

        if (inPartial) break; // alignment found — stop stripping

        // Word is absent from partial — check confidence before stripping
        const isLowC = confMap.has(fw) ? confMap.get(fw) : true; // default to uncertain if unknown
        if (isLowC) {
            prefixHallucCount++;
        } else {
            break; // high-confidence word not in partial — leave it (beam search found something new)
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
        
        // [FIX — BASE MODEL PREFIX STRIP]: Remove segment-start hallucinations from base/tiny models
        for (const pattern of BASE_MODEL_PREFIX_PATTERNS) {
            filteredText = filteredText.replace(pattern, '');
        }
        filteredText = filteredText.trim();
        
        // If the entire segment was a hallucination, discard it
        if (!filteredText || filteredText.length < 2) {
            self.postMessage({ type: 'NLP_DONE', tokens: [] }); 
            return;
        }
        text = filteredText;

        // [OPT — MBR PREFIX ANCHOR]: Strip hallucinated leading words not present in last partial
        // This catches prefix cascade (Più po', Cambiamo di terr, mapoli) even if not in pattern list
        if (e.data.lastPartialText) {
            filteredText = mbrPrefixCheck(filteredText, e.data.lastPartialText, wordConf);
            filteredText = filteredText.trim();
            if (!filteredText || filteredText.length < 2) {
                self.postMessage({ type: 'NLP_DONE', tokens: [] }); return;
            }
            text = filteredText;
        }

        // Dedup repetitions (exact)
        text = text.replace(/\b([a-zA-ZÀ-ÿ\s']{2,50}?)\b(?:\s+\1\b){1,}/gi, '$1'); 
        text = text.replace(/([a-zA-ZÀ-ÿ']{2,})([\s,;.!?]+\1){3,}/gi, '$1');
        
        // [FIX — CHARACTER STUTTER LOOP]: Collapse extreme Whisper character hallucinations (e.g. "sovvvvvvvvvv...")
        text = text.replace(/([a-zA-ZÀ-ÿ])\1{2,}/gi, '$1$1');
        
        if (currentLang === 'italian') {
            text = text.replace(/\b(un)\s+po\b/gi, "$1 po'");
            text = text.replace(/\b(qual)\s+e\b/gi, "$1 è");
            // [DISABLED — CAUSED FALSE POSITIVES]: Was inserting 's' before consonants after 'lo', corrupting correct words
            // text = text.replace(/\b(lo|dello|allo|sullo)\s+([bcdfghkmnpqrtvw]\w+)\b/gi, (m, p1, p2) => p1 + ' s' + p2);

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
        let rawWords = text.split(/ +/);
        let mergedTokens = [];
        
        // [FIX — MULTI-WORD ENTITY MERGING]: Whisper often splits long unknown words
        // e.g. "Civitavecchia" -> "cività vecchia", "Superfood" -> "super food"
        // We use a sliding window to check if adjacent word pairs match a dictionary entity.
        for (let i = 0; i < rawWords.length; i++) {
            if (i < rawWords.length - 1) {
                const w1 = rawWords[i];
                const w2 = rawWords[i+1];
                // Strip punctuation and accents for a clean combined check
                const combinedClean = (w1 + w2).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, '');
                
                if (combinedClean.length >= 6) {
                    let bestPairMatch = null, minPairDist = Infinity;
                    active.forEach(ref => {
                        const refClean = ref.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, '');
                        if (Math.abs(refClean.length - combinedClean.length) > 2) return;
                        let d = levenshtein(combinedClean, refClean);
                        if (d < minPairDist) { minPairDist = d; bestPairMatch = ref; }
                    });
                    
                    // If the combined pair is very close to a dictionary word, merge them!
                    if (bestPairMatch && minPairDist <= 1) {
                        // Extract leading/trailing punctuation from the original pair
                        const match1 = w1.match(/^([^a-zA-ZÀ-ÿ]*)/);
                        const match2 = w2.match(/([^a-zA-ZÀ-ÿ]*)$/);
                        const prefix = match1 ? match1[1] : '';
                        const suffix = match2 ? match2[1] : '';
                        
                        const healedWord = prefix + bestPairMatch[0].toUpperCase() + bestPairMatch.slice(1) + suffix;
                        mergedTokens.push({ text: healedWord, isLowConf: false, healed: true, merged: true });
                        i++; // skip the next word since we merged it
                        continue;
                    }
                }
            }
            mergedTokens.push({ text: rawWords[i], isLowConf: null, healed: false, merged: false });
        }

        const tokens = mergedTokens.map((t) => {
            if (t.merged) return { text: t.text, isLowConf: false, healed: true }; // Already fully healed by merger
            
            let original = t.text; 
            let healed = false; 
            
            // [FIX — PER-WORD CONFIDENCE]: Use word-level confidence if available, else fall back to segment avg
            const cleanW = original.toLowerCase().replace(/[^a-zA-ZÀ-ÿ']/g, '');
            let lowC = wordConfMap.has(cleanW) ? wordConfMap.get(cleanW) : isLowConf;

            const match = original.match(/^([^a-zA-ZÀ-ÿ]*)([a-zA-ZÀ-ÿ]+)([^a-zA-ZÀ-ÿ]*)$/);
            
            // [FIX — HEALING GATED ON LOW CONFIDENCE]: Only attempt Levenshtein correction on words
            // that Whisper itself marked as uncertain. Healing high-confidence words causes
            // the 'correction deviates toward wrong words' effect observed with tiny model.
            if (match && /^[A-ZÀ-Ÿ]/.test(match[2]) && lowC) {
                const [_, prefix, core, suffix] = match;
                const lower = core.toLowerCase();
                
                if (lower.length >= 4) {
                    // [OPT — JARO-WINKLER HEALING]: JW ≥ 0.85 threshold outperforms Levenshtein ≤ 1
                    // for ASR-type errors where the word prefix is usually correct (ACL 2024).
                    let best = null, maxJW = 0, exactMatch = false;
                    const jwThreshold = lower.length >= 8 ? 0.85 : 0.88; // tighter for short words
                    
                    active.forEach(ref => {
                        if (exactMatch) return;
                        if (ref === lower) { exactMatch = true; maxJW = 1.0; best = ref; return; }
                        if (Math.abs(ref.length - lower.length) > 3) return; // length pre-filter O(1)
                        // [OPT — FIRST-CHAR FILTER]: ASR almost always gets the first phoneme right.
                        // If first chars differ, skip the O(n*m) JW computation entirely. Eliminates ~85% candidates.
                        if (lower[0] !== ref[0]) return;
                        const jw = jaroWinkler(lower, ref);
                        if (jw > maxJW) { maxJW = jw; best = ref; }
                        // [OPT — EARLY EXIT]: JW > 0.95 is a near-exact match — no need to keep searching
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
