"""Render the launch trailer (trailer.js) to a video.

    python trailer_render.py     # then open http://localhost:8123/?trailer=render (the dev server: python serve.py)

The page renders every frame (1920x1080, 30 fps) and the soundtrack and posts them here; this saves them and, when the
last one is in, has ffmpeg put them together as impactbox-trailer.mp4. Needs ffmpeg on the PATH.
"""
import base64
import http.server
import os
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
FRAMES = os.path.join(HERE, 'trailer-frames')
OUT = os.path.join(HERE, 'impactbox-trailer.mp4')


class Sink(http.server.BaseHTTPRequestHandler):
    def _ok(self, body=b'ok'):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.end_headers()

    def do_POST(self):
        data = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path == '/audio':
            shutil.rmtree(FRAMES, ignore_errors=True)       # a new render
            os.makedirs(FRAMES)
            open(os.path.join(FRAMES, 'audio.wav'), 'wb').write(data)
        elif self.path.startswith('/frame/'):
            open(os.path.join(FRAMES, '%05d.jpg' % int(self.path[7:])), 'wb').write(base64.b64decode(data.split(b',', 1)[1]))   # (a data: URL)
        elif self.path == '/done':
            fps = data.decode() or '30'
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', fps, '-i', os.path.join(FRAMES, '%05d.jpg'),
                            '-i', os.path.join(FRAMES, 'audio.wav'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
                            '-pix_fmt', 'yuv420p', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,alimiter=limit=0.8:level=false', '-ar', '48000',
                            '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], check=True)
            print('wrote', OUT)
        self._ok()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print('waiting for frames on http://127.0.0.1:8125 - open the game with ?trailer=render')
    http.server.ThreadingHTTPServer(('127.0.0.1', 8125), Sink).serve_forever()
