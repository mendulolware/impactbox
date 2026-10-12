"""Tiny dev server: serves this folder with caching disabled.

    python serve.py          # then open http://localhost:8123
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer.allow_reuse_address = True
with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"IMPACTBOX running at http://localhost:{PORT}")
    httpd.serve_forever()
