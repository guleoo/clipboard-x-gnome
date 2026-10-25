#!/usr/bin/env python3
"""Mutable dictionary endpoint; records request counts, never fetches external URLs."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import sys
import ssl
import threading
import time

directory = Path(sys.argv[1])
state = {'port': 0, 'requests': 0}
parent = os.getppid()


def watch_parent():
    while os.getppid() == parent:
        time.sleep(0.2)
    os._exit(0)


threading.Thread(target=watch_parent, daemon=True).start()


def save():
    temporary = directory / 'state.tmp'
    temporary.write_text(json.dumps(state))
    temporary.replace(directory / 'state.json')


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def serve(self):
        state['requests'] += 1
        save()
        configuration = json.loads((directory / 'response.json').read_text())
        body = configuration['text'].encode()
        self.send_response(configuration.get('status', 200))
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    do_GET = do_HEAD = serve


server = HTTPServer(('127.0.0.1', 0), Handler)
if '--tls' in sys.argv[2:]:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(directory / 'cert.pem', directory / 'key.pem')
    server.socket = context.wrap_socket(server.socket, server_side=True)
state['port'] = server.server_port
save()
server.serve_forever()
