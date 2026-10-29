"""Delay reading stdin until the parent's main loop releases this test editor."""

import sys
import time
from pathlib import Path


source, release = map(Path, sys.argv[1:])
deadline = time.monotonic() + 5
while not release.exists():
    if time.monotonic() >= deadline:
        raise SystemExit("The parent main loop did not release the editor")
    time.sleep(0.01)

with source.open("rb") as expected:
    while True:
        chunk = expected.read(64 * 1024)
        if sys.stdin.buffer.read(len(chunk)) != chunk:
            raise SystemExit("Editor received different image bytes")
        if not chunk:
            break
    if sys.stdin.buffer.read(1):
        raise SystemExit("Editor received trailing image bytes")
