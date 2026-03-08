import { UI } from './ui.js';

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
            try {
                const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                const resp = await fetch(proxyUrl, { credentials: 'omit' });
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.contents) {
                        const parser = new DOMParser();
                        const xml = parser.parseFromString(data.contents, "text/xml");
                        const items = Array.from(xml.querySelectorAll("item"));
                        for (const item of items) {
                            allItems.push({
                                title: item.querySelector("title")?.textContent || "",
                                description: item.querySelector("description")?.textContent || ""
                            });
                        }
                    }
                }
            } catch (err) {
                console.warn("[APEX] Feed sync skipped:", url);
            }
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
                    window.dispatchEvent(new CustomEvent('zeitgeist_sync_done'));
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
