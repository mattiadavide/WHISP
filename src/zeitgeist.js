import { UI } from './ui.js';
export const experienceDict = new Set();
export const referenceDict = new Map(); 
export let dynamicStopWords = new Set();

// [IDF FILTERING] — Words that appear in many documents across all contexts
// are common/structural words with no discriminative power for Whisper priming.
// These are separated into commonPool and excluded from the top-N prompt.
// Threshold: words appearing in >30% of all scraped articles go to commonPool.
export const commonPool = new Set();
const _IDF_DOC_THRESHOLD = 0.30;  
const docFrequency = new Map(); // term → number of documents it appeared in

export function filterCommonTokens() {
    if (_bm25TotalDocs < 5) return; // not enough docs yet to compute reliable IDF
    const movedToCommon = [];
    referenceDict.forEach((score, term) => {
        const df = docFrequency.get(term) || 0;
        const dfRatio = df / _bm25TotalDocs;
        if (dfRatio > _IDF_DOC_THRESHOLD) {
            commonPool.add(term);
            referenceDict.delete(term);
            movedToCommon.push(term);
        }
    });
    if (movedToCommon.length > 0) {
        UI.zeitgeistLog.innerText += `\n> COMMON_POOL [${movedToCommon.length} TERMS FILTERED — ${referenceDict.size} DISCRIMINATIVE REMAIN]`;
    }
}

// [PHONETIC SUGGESTIONS — JARO-WINKLER]
export function jaroWinkler(s1, s2, p = 0.1) {
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

function saveExperience() {
    localStorage.setItem('whisp_permanent_experience', JSON.stringify(Array.from(experienceDict)));
}

// [CLOSED-LOOP FEEDBACK] — Boost a token that Whisper emitted with low confidence.
// Respects commonPool: boosting a structurally-common word is wasteful.
export function boostToken(word, weight = 12) {
    if (!word || word.length < 3) return;
    const lower = word.toLowerCase().replace(/[^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]/g, '');
    if (!lower || dynamicStopWords.has(lower) || commonPool.has(lower)) return;
    
    const isNew = !experienceDict.has(lower);
    referenceDict.set(lower, (referenceDict.get(lower) || 0) + weight);
    
    if (weight >= 50) { // High weight = manual validation
        experienceDict.add(lower);
        saveExperience();
    }
}
export async function loadStopWords(languageVal) {
    const langCodes = { "italian": "it", "english": "en", "spanish": "es", "french": "fr", "german": "de" };
    try {
        const res = await fetch(`https://raw.githubusercontent.com/stopwords-iso/stopwords-${langCodes[languageVal] || "it"}/master/stopwords-${langCodes[languageVal] || "it"}.txt`);
        if (!res.ok) throw new Error("Fetch failed");
        const text = await res.text();
        dynamicStopWords = new Set(text.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0));
        UI.zeitgeistLog.innerText += `\n> STOPWORDS_LOADED [${dynamicStopWords.size} RULES]`;
    } catch (e) {
        dynamicStopWords = new Set(); 
    }
}
const _BM25_K1 = 1.5;   
const _BM25_B  = 0.75;  
let _bm25TotalDocs = 0;
let _bm25AvgDocLen = 1;  
export function extractValuableTokens(text) {
    if (!text) return;
    const words = text.match(/[a-zA-ZÀ-ÿ]{3,}/g);
    if (!words) return;
    const dl = words.length;
    _bm25TotalDocs++;
    _bm25AvgDocLen = _bm25AvgDocLen + (dl - _bm25AvgDocLen) / _bm25TotalDocs;
    const tf = new Map();
    // Track unique terms per document for IDF computation
    const seenInThisDoc = new Set();
    words.forEach(w => {
        const isCapitalized = /^[A-Z]/.test(w) && w.toUpperCase() !== w;
        const lower = w.toLowerCase();
        if (dynamicStopWords.has(lower)) return;
        tf.set(lower, (tf.get(lower) || 0) + (isCapitalized ? 8 : 1));
        if (!seenInThisDoc.has(lower)) {
            seenInThisDoc.add(lower);
            docFrequency.set(lower, (docFrequency.get(lower) || 0) + 1);
        }
    });
    const normFactor = 1 - _BM25_B + _BM25_B * (dl / _bm25AvgDocLen);
    tf.forEach((freq, term) => {
        if (commonPool.has(term)) return; // already classified as common, skip
        const bm25Score = (freq * (_BM25_K1 + 1)) / (freq + _BM25_K1 * normFactor);
        referenceDict.set(term, (referenceDict.get(term) || 0) + bm25Score);
    });

    // [MEMORY CAP] — Preserve browser RAM by capping the referenceDict at 5000 lemmas.
    // If the limit is exceeded, prune the words with the lowest cumulative BM25 scores.
    const MEMORY_CAP = 5000;
    if (referenceDict.size > MEMORY_CAP) {
        const sorted = Array.from(referenceDict.entries()).sort((a, b) => b[1] - a[1]);
        referenceDict.clear();
        for (let i = 0; i < MEMORY_CAP; i++) {
            referenceDict.set(sorted[i][0], sorted[i][1]);
        }
    }
}
let hasGlobalZeitgeistLoaded = false;

export async function fetchZeitgeist(domain, languageVal = 'italian') {
    if (domain === 'custom') return;
    
    // [FIX 2 — PREVENT REDUNDANT SYNC]: Prevent "Start" button from re-downloading tokens
    if (domain === 'global' && hasGlobalZeitgeistLoaded) {
        window.dispatchEvent(new CustomEvent('zeitgeist_sync_done', { detail: { count: referenceDict.size + experienceDict.size } }));
        return;
    }
    
    // [UNLIMITED SOURCES]: Public CORS proxies break inside COEP isolated contexts. 
    // We use Wikipedia exclusively, mixing Current Events searches with Random articles 
    // for a massive volume of highly context-relevant words.
    
    const wikiLang = languageVal === 'english' ? 'en' : languageVal === 'spanish' ? 'es' : languageVal === 'french' ? 'fr' : languageVal === 'german' ? 'de' : 'it';
    const newsTerms = {
        "italian": "Attualità",
        "english": "Current events",
        "french": "Actualités",
        "spanish": "Actualidad",
        "german": "Aktuelle Nachrichten"
    };
    const newsTerm = newsTerms[languageVal] || "Attualità";
    
    let allItems = [];
    
    try {
        window.dispatchEvent(new CustomEvent('zeitgeist_progress', { detail: { p: 10, status: 'FETCHING_CURRENT_EVENTS' } }));

        // 1. Fetch Current Events Wikipedia (robust COEP-friendly alternative to RSS)
        const newsApi = `https://${wikiLang}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(newsTerm)}&gsrlimit=50&prop=extracts&explaintext=1&origin=*`;
        try {
            const newsResp = await fetch(newsApi);
            const newsData = await newsResp.json();
            if (newsData.query?.pages) {
                allItems.push(...Object.values(newsData.query.pages).map(p => ({ title: p.title, description: p.extract || "" })));
            }
        } catch (err) {
            console.warn("[ZEITGEIST] Failed to fetch Wiki News:", err);
        }

        window.dispatchEvent(new CustomEvent('zeitgeist_progress', { detail: { p: 20, status: 'FETCHING_WIKI_RANDOM' } }));

        // 2. Fetch Wikipedia Random Articles (Unlimited volume, free)
        const randomApi = `https://${wikiLang}.wikipedia.org/w/api.php?action=query&format=json&generator=random&grnnamespace=0&grnlimit=50&prop=extracts&explaintext=1&origin=*`;
        
        // Fetch 3 batches of 50 to get 150 full-text articles
        for (let batch = 0; batch < 3; batch++) {
            try {
                window.dispatchEvent(new CustomEvent('zeitgeist_progress', { detail: { p: 20 + (batch * 6), status: 'FETCHING_WIKI_BATCH_' + (batch+1) } }));
                const wikiResp = await fetch(randomApi);
                const wikiData = await wikiResp.json();
                if (wikiData.query?.pages) {
                    allItems.push(...Object.values(wikiData.query.pages).map(p => ({ title: p.title, description: p.extract || "" })));
                }
            } catch (err) {
                console.warn("[ZEITGEIST] Failed to fetch Wiki batch:", err);
            }
        }

        window.dispatchEvent(new CustomEvent('zeitgeist_progress', { detail: { p: 40, status: 'PARSING_TOKENS_FULL' } }));

        if (allItems.length > 0) {
            hasGlobalZeitgeistLoaded = true;
            let i = 0;
            const processChunk = () => {
                const end = Math.min(i + 5, allItems.length); // Smaller chunks because texts are now FULL (much longer)
                for (; i < end; i++) {
                    const item = allItems[i];
                    extractValuableTokens((item.title || "") + " " + (item.description || "").replace(/<[^>]*>?/gm, ''));
                }
                
                const progress = 40 + Math.floor((i / allItems.length) * 60);
                window.dispatchEvent(new CustomEvent('zeitgeist_progress', { detail: { p: progress, status: 'SYNCING' } }));

                if (i < allItems.length) {
                    setTimeout(processChunk, 15);
                } else {
                    // [IDF FILTER]: Run after all articles are parsed.
                    // Moves tokens that appear in >30% of documents to commonPool,
                    // leaving only discriminative domain vocabulary in referenceDict.
                    filterCommonTokens();
                    UI.zeitgeistLog.innerText += `\n> ZEITGEIST_SYNC_OK [TOKENS: ${referenceDict.size} DISCRIMINATIVE / ${commonPool.size} COMMON]`;
                    window.dispatchEvent(new CustomEvent('zeitgeist_progress', { detail: { p: 100, status: 'DONE' } }));
                    window.dispatchEvent(new CustomEvent('zeitgeist_sync_done', { detail: { count: referenceDict.size + experienceDict.size } }));
                }
            };
            processChunk(); 
        } else {
            throw new Error("No items found");
        }
    } catch (e) { 
        console.error("[ZEITGEIST] Fetch error:", e);
        UI.zeitgeistLog.innerText += `\n> ZEITGEIST_SYNC_FAIL: USING_LOCAL_FALLBACK`; 
        window.dispatchEvent(new CustomEvent('zeitgeist_progress', { detail: { p: 0, status: 'ERROR' } }));
    }; 
}