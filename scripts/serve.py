"""Local static preview with the same isolation headers as the deployment."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import sys

os.chdir(Path(__file__).resolve().parent.parent / "dist")

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        if "--plain" not in sys.argv:
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

if __name__ == "__main__":
    print("Prosody: http://127.0.0.1:4173", flush=True)
    ThreadingHTTPServer(("127.0.0.1", 4173), Handler).serve_forever()
