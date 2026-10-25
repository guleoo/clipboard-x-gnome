"""A loopback-only browser input receiver with no navigation or external assets."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import html
import json
import os
from pathlib import Path
import sys
import threading
import time

directory = Path(sys.argv[1])
title = html.escape(sys.argv[2])
parent = os.getppid()
state = {'port': 0, 'ready': False, 'text': '', 'gets': 0}


def save():
    temporary = directory / 'state.tmp'
    temporary.write_text(json.dumps(state))
    temporary.replace(directory / 'state.json')


def watch():
    while os.getppid() == parent:
        time.sleep(0.2)
    os._exit(0)


threading.Thread(target=watch, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        state['gets'] += 1
        save()
        if self.path == '/ready':
            state['ready'] = True
            save()
            self.send_response(204)
            self.end_headers()
            return
        document = (f'<!doctype html><meta charset="utf-8"><title>{title}</title>'
                    '<style>body{display:grid;place-items:center;height:80vh;margin:0}textarea{width:80vw;height:55vh}</style>'
                    '<textarea autofocus spellcheck="false"></textarea><script>'
                    'let timer;const input=document.querySelector("textarea");'
                    'input.addEventListener("input",()=>{clearTimeout(timer);timer=setTimeout(()=>fetch("/received",'
                    '{method:"POST",body:input.value}),30)});fetch("/ready");</script>').encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'")
        self.send_header('Content-Length', str(len(document)))
        self.end_headers()
        self.wfile.write(document)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if self.path != '/received' or not 0 <= length <= 32768:
            self.send_error(400)
            return
        state['text'] = self.rfile.read(length).decode()
        save()
        self.send_response(204)
        self.end_headers()


server = HTTPServer(('127.0.0.1', 0), Handler)
state['port'] = server.server_port
save()
server.serve_forever()
