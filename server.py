import http.server
import socketserver

PORT = 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Header necessari per i SharedArrayBuffer (Cross-Origin Isolation)
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Server Web (con COOP/COEP) in ascolto sulla porta {PORT}")
    print("Premi Ctrl+C per fermarlo.")
    httpd.serve_forever()
