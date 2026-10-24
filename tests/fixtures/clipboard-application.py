#!/usr/bin/env python3
"""Own one external clipboard application's process group inside a private desktop."""
import os
from pathlib import Path
import signal
import sys

runtime = Path(os.environ.get('CBX_SIMULATION_RUNTIME', '')).resolve()
if not str(runtime).startswith('/tmp/clipboard-x-simulation-'):
    raise SystemExit('External clipboard applications require the isolated runner')
for name in ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME']:
    if not Path(os.environ[name]).resolve().is_relative_to(runtime):
        raise SystemExit('Refuse non-isolated external application directories')

if sys.argv[1] == 'launch':
    os.setsid()
    os.execvp(sys.argv[2], sys.argv[2:])
elif sys.argv[1] == 'stop':
    # The caller retains this PID from its own setsid launcher, never from pgrep.
    process_group = int(sys.argv[2])
    if process_group <= 1 or process_group == os.getpgrp():
        raise SystemExit('Refuse unrelated process group')
    try:
        os.killpg(process_group, getattr(signal, f'SIG{sys.argv[3]}'))
    except ProcessLookupError:
        pass
else:
    raise SystemExit('Unknown private application operation')
