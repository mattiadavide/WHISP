import http.server
import socketserver
import urllib.request
import urllib.parse

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Header necessari per i SharedArrayBuffer (Cross-Origin Isolation)
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def do_GET(self):
        # Simple local proxy to bypass browser CORS and external rate limits for RSS feeds
        if self.path.startswith('/proxy?url='):
            target_url = urllib.parse.unquote(self.path.split('/proxy?url=')[1])
            try:
                req = urllib.request.Request(target_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as response:
                    content = response.read()
                    self.send_response(200)
                    self.send_header('Content-type', 'application/xml')
                    self.end_headers()
                    self.wfile.write(content)
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
            return
        super().do_GET()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Server Web (con proxy && COOP/COEP) in ascolto sulla porta {PORT}")
    print("Premi Ctrl+C per fermarlo.")
    httpd.serve_forever()
