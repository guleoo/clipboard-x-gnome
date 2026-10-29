"""Prepare special XDG directories before the isolated Shell caches them."""
import json
import os
from pathlib import Path
import sys
import subprocess

runtime = Path(os.environ['CBX_SIMULATION_RUNTIME']).resolve()
configuration = Path(os.environ['XDG_CONFIG_HOME']).resolve()
if not str(runtime).startswith('/tmp/clipboard-x-simulation-') or not configuration.is_relative_to(runtime):
    raise SystemExit('Refuse non-isolated special directory configuration')
configuration.mkdir(parents=True, exist_ok=True)
entries = []
for name in ['DESKTOP', 'DOWNLOAD', 'TEMPLATES', 'PUBLICSHARE', 'DOCUMENTS', 'MUSIC', 'PICTURES', 'VIDEOS']:
    path = runtime / name.lower()
    path.mkdir(mode=0o700, exist_ok=True)
    entries.append(f'XDG_{name}_DIR={json.dumps(str(path))}')
(configuration / 'user-dirs.dirs').write_text('\n'.join(entries) + '\n')
# File choosers may activate a search indexer. Keep its crawl roots private too;
# isolated XDG alone must not let a default recursive $HOME policy scan user data.
schemas = subprocess.check_output(['gsettings', 'list-schemas'], text=True).splitlines()
if 'org.freedesktop.Tracker3.Miner.Files' in schemas:
    for key, value in [('index-recursive-directories', json.dumps([str(runtime / 'documents')])),
                       ('index-single-directories', '[]'), ('enable-monitors', 'false')]:
        subprocess.run(['gsettings', 'set', 'org.freedesktop.Tracker3.Miner.Files', key, value], check=True)
# The official test tool changes XDG after dbus-run-session starts. Without this
# update, D-Bus-activated portals/file managers inherit the caller's old XDG and
# ignore the private MIME defaults. This is always the runner's private bus.
subprocess.run(['dbus-update-activation-environment',
                *[key for key in ['XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME',
                                  'XDG_STATE_HOME', 'XDG_RUNTIME_DIR', 'GSETTINGS_BACKEND',
                                  'LANGUAGE', 'LANG', 'LC_ALL', 'GTK_A11Y', 'NO_AT_BRIDGE'] if key in os.environ]], check=True)
os.execvp(sys.argv[1], sys.argv[1:])
