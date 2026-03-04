const ALLOWED_DOMAINS = [
    location.origin,
    'https://cdn.jsdelivr.net',
    'https://huggingface.co',
    'https://raw.githubusercontent.com'
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const isAllowed = ALLOWED_DOMAINS.some(domain => url.href.startsWith(domain));
    
    // Privacy Lock: Blocca richieste non autorizzate
    if (!isAllowed) {
        event.respondWith(new Response('Accesso Negato per Privacy', { status: 403 }));
        return;
    }

    // Proxy con Header di Isolamento (COOP/COEP) per abilitare SharedArrayBuffer
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                if (response.status === 0) return response;

                const newHeaders = new Headers(response.headers);
                newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
                newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
                newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");

                return new Response(response.body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: newHeaders,
                });
            })
            .catch((e) => console.error(e))
    );
});
