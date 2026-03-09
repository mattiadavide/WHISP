import { UI } from './ui.js';
export const experienceDict = new Set();
export const referenceDict = new Map(); 
export let dynamicStopWords = new Set();

// [CLOSED-LOOP FEEDBACK] — Boost a token that Whisper emitted with low confidence.
// By elevating its score in referenceDict, it rises in the top-N sort used to build
// the Whisper prompt on the next re-sync, priming the Cross-Attention layer to 
// recognise it correctly in subsequent audio segments.
export function boostToken(word, weight = 12) {
    if (!word || word.length < 3) return;
    const lower = word.toLowerCase().replace(/[^a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]/g, '');
    if (!lower || dynamicStopWords.has(lower)) return;
    referenceDict.set(lower, (referenceDict.get(lower) || 0) + weight);
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
    words.forEach(w => {
        const isCapitalized = /^[A-Z]/.test(w) && w.toUpperCase() !== w;
        const lower = w.toLowerCase();
        if (dynamicStopWords.has(lower)) return;
        tf.set(lower, (tf.get(lower) || 0) + (isCapitalized ? 8 : 1));
    });
    const normFactor = 1 - _BM25_B + _BM25_B * (dl / _bm25AvgDocLen);
    tf.forEach((freq, term) => {
        const bm25Score = (freq * (_BM25_K1 + 1)) / (freq + _BM25_K1 * normFactor);
        referenceDict.set(term, (referenceDict.get(term) || 0) + bm25Score);
    });
}
let hasGlobalZeitgeistLoaded = false;

export async function fetchZeitgeist(domain, languageVal = 'italian') {
    if (domain === 'custom') return;
    
    // [FIX 2 — PREVENT REDUNDANT SYNC]: Prevent "Start" button from re-downloading tokens
    if (domain === 'global' && hasGlobalZeitgeistLoaded) {
        window.dispatchEvent(new CustomEvent('zeitgeist_sync_done', { detail: { count: referenceDict.size } }));
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
                    setTimeout(processChunk, 15); // Slightly more delay to keep UI smooth during heavy parsing
                } else {
                    UI.zeitgeistLog.innerText += `\n> ZEITGEIST_SYNC_OK [TOKENS: ${referenceDict.size}]`;
                    window.dispatchEvent(new CustomEvent('zeitgeist_progress', { detail: { p: 100, status: 'DONE' } }));
                    window.dispatchEvent(new CustomEvent('zeitgeist_sync_done', { detail: { count: referenceDict.size } }));
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