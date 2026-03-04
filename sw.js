const ALLOWED_DOMAINS = [
    'huggingface.co',
    'cdn-lfs.huggingface.co',
    'cdn.jsdelivr.net'
];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const isLocal = url.origin === location.origin;
    const isAllowed = ALLOWED_DOMAINS.some(d => url.hostname.endsWith(d));
    
    if (!isLocal && !isAllowed) {
        event.respondWith(new Response('Privacy Block: Domain not allowed', { status: 403 }));
        return;
    }

    event.respondWith(
        fetch(event.request).then(response => {
            if (response.status === 0) return response;
            
            const newHeaders = new Headers(response.headers);
            // Iniezione header per SharedArrayBuffer e superamento blocchi CORP
            newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
            newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
            newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
            });
        }).catch(e => {
            console.error("[SW_FETCH_ERR]", e);
            return new Response("Network Error", { status: 408 });
        })
    );
});
