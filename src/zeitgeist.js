import { UI } from './ui.js';
import { workerStore } from './main.js';

export const experienceDict = new Set();
export const referenceDict = new Set();
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

export function extractValuableTokens(text) {
    if (!text) return;
    const words = text.match(/[a-zA-ZÀ-ÿ]{4,}/g);
    if (words) {
        words.forEach(w => { 
            const lower = w.toLowerCase(); 
            if (!dynamicStopWords.has(lower)) referenceDict.add(lower); 
        });
    }
}

export async function fetchZeitgeist(domain) {
    if (domain === 'custom') return;
    UI.zeitgeistLog.innerText += `\n> SYNCING_ZEITGEIST...`;
    
    const FEEDS = { 
        "general": "https://news.google.com/rss?hl=it&gl=IT&ceid=IT:it", 
        "tech": "https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=it&gl=IT&ceid=IT:it",
        "finance": "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=it&gl=IT&ceid=IT:it", 
        "medical": "https://news.google.com/rss/headlines/section/topic/HEALTH?hl=it&gl=IT&ceid=IT:it",
        "sport": "https://news.google.com/rss/headlines/section/topic/SPORTS?hl=it&gl=IT&ceid=IT:it", 
        "art": "https://news.google.com/rss/headlines/section/topic/ENTERTAINMENT?hl=it&gl=IT&ceid=IT:it"
    };
    
    try {
        const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(FEEDS[domain] || FEEDS.general)}`;
        const resp = await fetch(proxyUrl, { credentials: 'omit' });
        if (!resp.ok) throw new Error("Proxy error");
        const data = await resp.json();
        
        if (data.status === 'ok' && data.items && data.items.length > 0) {
            let i = 0;
            const processChunk = () => {
                const end = Math.min(i + 5, data.items.length); // Process 5 items at a time
                for (; i < end; i++) {
                    const item = data.items[i];
                    extractValuableTokens((item.title || "") + " " + (item.description || "").replace(/<[^>]*>?/gm, ''));
                }
                if (i < data.items.length) {
                    setTimeout(processChunk, 0); // Yield to main thread (60fps render loop)
                } else {
                    UI.zeitgeistLog.innerText += `\n> ZEITGEIST_SYNC_OK [TOKENS: ${referenceDict.size}]`;
                    if (workerStore.whisper && workerStore.whisper.worker) {
                        workerStore.whisper.worker.postMessage({ type: 'update_params', prompt: Array.from(referenceDict).join(' ') });
                    }
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
