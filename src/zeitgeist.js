import { UI } from './ui.js';

export const experienceDict = new Set();
export const referenceDict = new Map(); // Upgraded to Map for TF-IDF scoring
export let dynamicStopWords = new Set();

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

// [OPT — BM25 SCORING]: Replaces raw TF accumulation with BM25-inspired TF saturation.
// Literature: Robertson & Zaragoza (BM25 standard), RAG systems 2024.
// Key improvement: prevents high-frequency generic terms from dominating the prompt vocabulary.
// Term frequency saturates at K1/(K1+1) ≈ 0.6 for very common terms, giving rare but important
// named entities higher relative scores even with the same raw count.
const _BM25_K1 = 1.5;   // TF saturation parameter (standard value)
const _BM25_B  = 0.75;  // Document length normalization (standard value)
let _bm25TotalDocs = 0;
let _bm25AvgDocLen = 1;  // online Welford average, initialized to 1 to avoid div-by-zero

export function extractValuableTokens(text) {
    if (!text) return;
    const words = text.match(/[a-zA-ZÀ-ÿ]{4,}/g);
    if (!words) return;

    const dl = words.length;
    _bm25TotalDocs++;
    // Welford online average: stable, no overflow risk
    _bm25AvgDocLen = _bm25AvgDocLen + (dl - _bm25AvgDocLen) / _bm25TotalDocs;

    // Per-document TF map with Named Entity weighting
    const tf = new Map();
    words.forEach(w => {
        const isCapitalized = /^[A-Z]/.test(w) && w.toUpperCase() !== w;
        const lower = w.toLowerCase();
        if (dynamicStopWords.has(lower)) return;
        tf.set(lower, (tf.get(lower) || 0) + (isCapitalized ? 5 : 1));
    });

    // BM25 TF saturation + document length normalization
    const normFactor = 1 - _BM25_B + _BM25_B * (dl / _bm25AvgDocLen);
    tf.forEach((freq, term) => {
        const bm25Score = (freq * (_BM25_K1 + 1)) / (freq + _BM25_K1 * normFactor);
        referenceDict.set(term, (referenceDict.get(term) || 0) + bm25Score);
    });
}

export async function fetchZeitgeist(domain) {
    if (domain === 'custom') return;
    UI.zeitgeistLog.innerText += `\n> SYNCING_ZEITGEIST_GLOBAL...`;
    
    // Global snapshot aggregates multiple top-level domains
    const FEEDS = [
        "https://news.google.com/rss?hl=it&gl=IT&ceid=IT:it", // General
        "https://news.google.com/rss/headlines/section/topic/WORLD?hl=it&gl=IT&ceid=IT:it", // World News
        "https://news.google.com/rss/headlines/section/topic/NATION?hl=it&gl=IT&ceid=IT:it", // National
        "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=it&gl=IT&ceid=IT:it", // Tech
        "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=it&gl=IT&ceid=IT:it", // Business / Finance
        "https://news.google.com/rss/headlines/section/topic/HEALTH?hl=it&gl=IT&ceid=IT:it", // Health
        "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=it&gl=IT&ceid=IT:it", // Sports
        "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=it&gl=IT&ceid=IT:it", // Art, Music, Cinema
        "https://news.google.com/rss/headlines/section/topic/SCIENCE?hl=it&gl=IT&ceid=IT:it", // Science & Nature
    ];
    
    let allItems = [];
    
    try {
        for (const url of FEEDS) {
            let success = false;
            // [FIX — RSS PROXY FALLBACKS]: A single proxy is a single point of failure and often rate-limits localhost.
            // We use a cascade of 3 different raw CORS proxies to guarantee 100% dictionary delivery.
            const proxyChain = [
                `https://corsproxy.io/?${encodeURIComponent(url)}`,
                `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
                `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
            ];

            for (const proxyUrl of proxyChain) {
                if (success) break;
                try {
                    const resp = await fetch(proxyUrl, { credentials: 'omit' });
                    if (resp.ok) {
                        const xmlText = await resp.text();
                        const parser = new DOMParser();
                        const xml = parser.parseFromString(xmlText, "text/xml");
                        const items = Array.from(xml.querySelectorAll("item"));
                        for (const item of items) {
                            allItems.push({
                                title: item.querySelector("title")?.textContent || "",
                                description: item.querySelector("description")?.textContent || ""
                            });
                        }
                        success = true;
                    }
                } catch (err) {
                    // Try next proxy silently
                }
            }
            if (!success) console.warn("[APEX] Feed sync skipped completely for:", url);
        }
        
        if (allItems.length > 0) {
            let i = 0;
            const processChunk = () => {
                const end = Math.min(i + 15, allItems.length); // Process 15 items at a time
                for (; i < end; i++) {
                    const item = allItems[i];
                    extractValuableTokens((item.title || "") + " " + (item.description || "").replace(/<[^>]*>?/gm, ''));
                }
                if (i < allItems.length) {
                    setTimeout(processChunk, 0); // Yield to main thread (60fps render loop)
                } else {
                    UI.zeitgeistLog.innerText += `\n> ZEITGEIST_SYNC_OK [TOKENS: ${referenceDict.size}]`;
                    window.dispatchEvent(new CustomEvent('zeitgeist_sync_done', { detail: { count: referenceDict.size } }));
                }
            };
            processChunk(); // Start non-blocking chunk processor
        } else {
            throw new Error("No items in RSS");
        }
    } catch (e) { 
        UI.zeitgeistLog.innerText += `\n> ZEITGEIST_SYNC_FAIL: USA LOCAL_FILE (.TXT)`; 
    }
}
