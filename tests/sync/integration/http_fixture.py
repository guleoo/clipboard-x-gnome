"""Loopback-only streaming fixture, not a clipboard-x-server implementation."""

import hashlib
import json
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHUNK_BYTES = 64 * 1024


class Sampler:
    def __init__(self, pid):
        self.pid = pid
        self.stopped = threading.Event()
        self.baseline = self.read()
        self.peak = self.baseline
        self.samples = 0
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def read(self):
        with open(f"/proc/{self.pid}/status", encoding="utf-8") as status:
            for line in status:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
        raise RuntimeError("VmRSS is unavailable")

    def run(self):
        while not self.stopped.is_set():
            self.peak = max(self.peak, self.read())
            self.samples += 1
            self.stopped.wait(0.005)

    def finish(self):
        self.stopped.set()
        self.thread.join()
        self.peak = max(self.peak, self.read())
        return {"baseline": self.baseline, "peak": self.peak, "samples": self.samples}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def json(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path == "/metrics/start":
            value = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.server.sampler = Sampler(value["pid"])
            self.json(200, {"started": True})
        elif self.path == "/metrics/stop":
            self.rfile.read(int(self.headers.get("Content-Length", 0)))
            self.json(200, self.server.sampler.finish())
            self.server.sampler = None
        else:
            self.json(404, {})

    def authorized(self):
        if (self.headers.get("Authorization") != "Bearer stress-key"
                or self.headers.get("X-Clipboard-X-Device-Id") != "stress-device"):
            self.json(401, {"error": {"code": "unauthorized"}})
            self.close_connection = True
            return False
        return True

    def do_PUT(self):
        if not self.authorized():
            return
        size = int(self.headers["Content-Length"])
        checksum = hashlib.sha256()
        received = 0
        try:
            with open(self.server.content_path, "wb") as output:
                while received < size:
                    chunk = self.rfile.read(min(CHUNK_BYTES, size - received))
                    if not chunk:
                        return
                    output.write(chunk)
                    checksum.update(chunk)
                    received += len(chunk)
                    time.sleep(0.001)
            if self.path == "/reject":
                self.json(503, {"error": {"code": "temporarily_unavailable"}})
            else:
                self.json(200, {"size": received, "sha256": checksum.hexdigest()})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.authorized():
            return
        size = os.path.getsize(self.server.content_path)
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        if self.path == "/chunked":
            self.send_header("Transfer-Encoding", "chunked")
        elif self.path != "/no-length":
            declared = size + 1 if self.path == "/oversized" else size
            if self.path == "/excess":
                declared = CHUNK_BYTES
            self.send_header("Content-Length", str(declared))
        if self.path == "/compressed":
            self.send_header("Content-Encoding", "gzip")
        if self.path in ("/no-length", "/excess"):
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        sent = 0
        try:
            with open(self.server.content_path, "rb") as content:
                while chunk := content.read(CHUNK_BYTES):
                    if self.path == "/drop" and sent >= size // 2:
                        self.close_connection = True
                        return
                    if self.path == "/corrupt" and sent == 0:
                        chunk = bytes([chunk[0] ^ 1]) + chunk[1:]
                    if self.path == "/chunked":
                        self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                    else:
                        self.wfile.write(chunk)
                    self.wfile.flush()
                    sent += len(chunk)
                    time.sleep(0.001)
                if self.path == "/chunked":
                    self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass


with tempfile.TemporaryDirectory(prefix="cbx-http-fixture-") as directory:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    server.content_path = os.path.join(directory, "content.bin")
    server.sampler = None
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    print(json.dumps({"address": f"http://127.0.0.1:{server.server_port}"}), flush=True)
    # Parent closes stdin in finally; no background service remains.
    sys.stdin.buffer.read()
    if server.sampler:
        server.sampler.finish()
    server.shutdown()
    server.server_close()
