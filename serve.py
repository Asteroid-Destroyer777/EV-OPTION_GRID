#!/usr/bin/env python3
"""Локальный сервер EV-Option Grid: python3 serve.py [порт]. Сборка не нужна — ES-модули + локальный three.js."""
import http.server, os, sys, functools, webbrowser, threading

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 5173

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def log_message(self, *a):
        pass

if __name__ == '__main__':
    handler = functools.partial(Handler, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler)
    url = f'http://localhost:{PORT}/'
    print(f'EV-Option Grid запущен: {url}  (Ctrl+C — остановить)')
    if '--open' in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nОстановлено')
