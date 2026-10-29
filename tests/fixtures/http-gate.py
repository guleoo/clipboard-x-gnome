#!/usr/bin/env python3
"""Bounded streaming gate in front of the owned real sync server; never logs credentials/bodies."""
import argparse
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory', type=Path)
parser.add_argument('upstream')
parser.add_argument('--tls', action='store_true')
parser.add_argument('--prefix', default='')
arguments = parser.parse_args()
directory = arguments.directory
upstream = urlsplit(arguments.upstream)
if upstream.scheme != 'http' or upstream.hostname != '127.0.0.1':
    raise SystemExit('Only an owned loopback HTTP server may be gated')
lock = threading.Lock()
state = {'requests': [], 'port': 0}
used_drops = set()
parent = os.getppid()


def watch_parent():
    while os.getppid() == parent:
        time.sleep(0.2)
    os._exit(0)  # A crashed test Shell cannot run its normal finally cleanup.


threading.Thread(target=watch_parent, daemon=True).start()


def save():
    temporary = directory / 'state.tmp'
    temporary.write_text(json.dumps(state))
    temporary.replace(directory / 'state.json')


def policy():
    try:
        return json.loads((directory / 'policy.json').read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, *_args):
        pass

    def respond(self, record, status, value):
        body = json.dumps(value).encode()
        with lock:
            record.update(stage='response', status=status)
            save()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Connection', 'close')
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True
        with lock:
            record.update(stage='completed', status=status, bytes=len(body))
            save()

    def forward(self):
        record = {'method': self.command, 'path': self.path, 'stage': 'started', 'bytes': 0}
        configuration = policy()
        expected = configuration.get('authentication')
        if expected:
            record['authenticated'] = self.headers.get('Authorization') == 'Bearer ' + expected['apiKey']
            record['identified'] = self.headers.get('X-Clipboard-X-Device-Id') == expected['deviceId']
        with lock:
            state['requests'].append(record)
            state['requests'] = state['requests'][-500:]
            save()
        prefix = arguments.prefix
        if prefix and not self.path.startswith(prefix + '/'):
            return self.respond(record, 404, {})
        path = self.path[len(prefix):] if prefix else self.path
        if self.command == 'GET' and path == '/api/v1/status' and 'statusResponse' in configuration:
            return self.respond(record, 200, configuration['statusResponse'])
        matched = bool(re.search(configuration.get('path', '(?!)'), self.path))
        connection = http.client.HTTPConnection(upstream.hostname, upstream.port, timeout=25)
        try:
            # A hold is bounded even if a failing test never releases it.
            deadline = time.monotonic() + 20
            while matched and policy().get('hold') and time.monotonic() < deadline:
                with lock:
                    record['stage'] = 'held'
                    save()
                time.sleep(0.02)
            connection.putrequest(self.command, path, skip_host=True, skip_accept_encoding=True)
            for key, value in self.headers.items():
                if key.lower() not in {'connection', 'transfer-encoding', 'proxy-connection'}:
                    connection.putheader(key, value)
            connection.putheader('Connection', 'close')
            connection.endheaders()
            remaining = int(self.headers.get('Content-Length', 0))
            while remaining:
                chunk = self.rfile.read(min(32768, remaining))
                if not chunk:
                    raise ConnectionError('Client upload ended early')
                connection.send(chunk)
                remaining -= len(chunk)
                if matched and configuration.get('direction') == 'upload':
                    time.sleep(min(float(configuration.get('delay', 0)), 0.1))
            response = connection.getresponse()
            with lock:
                record['stage'] = 'response'
                record['status'] = response.status
                save()
            token = configuration.get('dropOnce')
            with lock:
                drop = matched and token and token not in used_drops
                if drop:
                    used_drops.add(token)
            if drop:
                while response.read(32768):
                    pass
                with lock:
                    record['stage'] = 'response-dropped'
                    save()
                self.connection.shutdown(socket.SHUT_RDWR)
                return
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in {'connection', 'transfer-encoding', 'server', 'date'}:
                    self.send_header(key, value)
            self.send_header('Connection', 'close')
            self.end_headers()
            while chunk := response.read(32768):
                self.wfile.write(chunk)
                self.wfile.flush()
                with lock:
                    record['bytes'] += len(chunk)
                    save()
                if matched and configuration.get('direction') == 'download':
                    time.sleep(min(float(configuration.get('delay', 0)), 0.1))
            with lock:
                record['stage'] = 'completed'
                save()
        except (OSError, ValueError, http.client.HTTPException):
            with lock:
                if record['stage'] != 'response-dropped':
                    record['stage'] = 'disconnected'
                save()
            self.close_connection = True
        finally:
            connection.close()

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = forward


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
server.daemon_threads = True
if arguments.tls:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(directory / 'cert.pem', directory / 'key.pem')
    server.socket = context.wrap_socket(server.socket, server_side=True)
state['port'] = server.server_port
with lock:
    save()
server.serve_forever()
