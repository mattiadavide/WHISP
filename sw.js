const ALLOWED_DOMAINS = [
    location.origin,
    'https://cdn.jsdelivr.net',
    'https://huggingface.co' // Rimuovere questo per isolamento TOTALE dopo il primo download
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const isAllowed = ALLOWED_DOMAINS.some(domain => url.href.startsWith(domain));
    
    if (!isAllowed) {
        console.error(`[PRIVACY_BLOCK] Richiesta non autorizzata a: ${url.href}`);
        event.respondWith(new Response('Accesso Negato per Privacy', { status: 403 }));
        return;
    }
    
    event.respondWith(fetch(event.request));
});
