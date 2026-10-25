"""Receive an actual custom editor launch, without using host applications/files."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import unquote, urlparse

runtime = Path(os.environ.get('CBX_SIMULATION_RUNTIME', '')).resolve()
if not str(runtime).startswith('/tmp/clipboard-x-simulation-'):
    raise SystemExit('Use the isolated simulation runner')
output = Path(sys.argv[1]).resolve()
if not output.is_relative_to(runtime):
    raise SystemExit('Editor report must belong to the private runtime')
mode, arguments = sys.argv[2], sys.argv[3:]
if mode == 'stdin':
    stream = sys.stdin.buffer
    source = None
else:
    source = arguments[-1]
    path = Path(unquote(urlparse(source).path) if source.startswith('file:') else source).resolve()
    if not path.is_relative_to(runtime):
        raise SystemExit('Editor input must belong to the private runtime')
    stream = path.open('rb')
digest = hashlib.sha256()
size = 0
with stream:
    while chunk := stream.read(65536):
        digest.update(chunk)
        size += len(chunk)
document = {'arguments': arguments, 'source': source, 'size': size, 'sha256': digest.hexdigest()}
temporary = output.with_suffix('.tmp')
temporary.write_text(json.dumps(document))
temporary.replace(output)
if mode == 'stay':
    time.sleep(15)
