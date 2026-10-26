#!/usr/bin/env python3
"""Real backend/client integration without GNOME Shell, GTK, displays or a session bus."""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import zipfile
from simulation_runtime import fingerprint

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / 'tests/logic/sync/integration/backend.test.js'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, nargs='?')
    parser.add_argument('--case', help='Comma-separated acceptance IDs')
    parser.add_argument('--output', type=Path, default=ROOT / 'build/sync-http-tests')
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--list', action='store_true')
    args = parser.parse_args()
    available = re.findall(r"^  '([^']+)':", CASES.read_text(), re.M)
    selected = args.case.split(',') if args.case else available
    if not selected or len(set(selected)) != len(selected) or set(selected) - set(available):
        parser.error('Empty, duplicate or unknown case selection')
    if args.list:
        print('\n'.join(f'{key}: headless production GJS + isolated HTTP backend' for key in selected))
        return 0
    if not args.archive or not args.archive.is_file() or not 1 <= args.timeout <= 7200:
        parser.error('A release ZIP and timeout between 1 and 7200 seconds are required')
    if not re.fullmatch(r'http://127\.0\.0\.1:\d+', os.environ.get('CBX_SIMULATION_SERVER', '')):
        parser.error('Use tools/test-sync-server.py --headless to own the local backend')
    for name in ['gjs', 'python3', 'timeout', 'glib-compile-schemas']:
        if not shutil.which(name):
            parser.error(f'Missing dependency: {name}')
    args.output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report = Path(tempfile.mkdtemp(prefix=f'sync-http-{stamp}-', dir=args.output)).resolve()
    archive_bytes = args.archive.read_bytes()
    source_hash = fingerprint(ROOT)
    results = {}
    with tempfile.TemporaryDirectory(prefix='cbx-sync-http-') as temporary:
        runtime = Path(temporary)
        extension = runtime / 'extension'
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            metadata = json.loads(archive.read('metadata.json'))
            if metadata.get('uuid') != 'clipboard-x-gnome@guleoo.github.io':
                parser.error('Unexpected extension UUID')
            for member in archive.infolist():
                path = PurePosixPath(member.filename)
                if path.is_absolute() or '..' in path.parts or member.external_attr >> 16 & 0o170000 == 0o120000:
                    parser.error('Unsafe archive member')
            archive.extractall(extension)
        subprocess.run(['glib-compile-schemas', '--strict', str(extension / 'schemas')], check=True)
        for index, key in enumerate(selected):
            if key == 'XFER-09-sha256sum' and not shutil.which('sha256sum'):
                results[key] = {'status': 'BLOCKED', 'reason': 'Missing sha256sum'}
                continue
            session = runtime / str(index)
            session.mkdir(mode=0o700)
            env = dict(os.environ, GSETTINGS_BACKEND='memory', GIO_USE_VFS='local',
                       CBX_SYNC_HTTP_RUNTIME=str(runtime), CBX_SYNC_EXTENSION_URI=extension.as_uri(),
                       XDG_DATA_HOME=str(session / 'data'), XDG_CONFIG_HOME=str(session / 'config'),
                       XDG_CACHE_HOME=str(session / 'cache'), XDG_STATE_HOME=str(session / 'state'),
                       XDG_RUNTIME_DIR=str(session), TMPDIR=str(session))
            for name in ['DISPLAY', 'WAYLAND_DISPLAY', 'DBUS_SESSION_BUS_ADDRESS', 'GDK_BACKEND',
                         'CBX_SIMULATION_RUNTIME', 'GSETTINGS_SCHEMA_DIR']:
                env.pop(name, None)
            log = report / f'{key}.log'
            with log.open('w') as output:
                code = subprocess.run(['timeout', '--kill-after=10s', f'{args.timeout}s', 'gjs', '-m', str(CASES), key],
                                      env=env, stdout=output, stderr=subprocess.STDOUT).returncode
            contents = log.read_text(errors='replace')
            passed = f'[sync-http] PASS {key}\n' in contents
            started = f'[sync-http] START {key}\n' in contents
            status = 'PASS' if passed and code == 0 else 'FAIL' if started else 'NOT_RUN'
            results[key] = {'status': status, 'exitCode': code, 'log': log.name}
            print(f"{results[key]['status']} {key}: {log}", flush=True)
    if fingerprint(ROOT) != source_hash:
        results['RUNNER:sources'] = {'status': 'FAIL', 'reason': 'Test sources changed during this run'}
    document = {'environment': 'headless GJS / real HTTP backend / isolated files',
                'gjs': subprocess.check_output(['gjs', '--version'], text=True).strip(),
                'archive': str(args.archive.resolve()), 'sha256': hashlib.sha256(archive_bytes).hexdigest(),
                'testsRevision': os.environ.get('CBX_SIMULATION_TEST_REVISION'),
                'testsFingerprint': source_hash, 'serverImage': os.environ.get('CBX_SIMULATION_SERVER_IMAGE'), 'results': results}
    (report / 'report.json').write_text(json.dumps(document, indent=2) + '\n')
    print(f'Report: {report}')
    return 1 if any(value['status'] in ['FAIL', 'NOT_RUN'] for value in results.values()) else 2 if any(value['status'] == 'BLOCKED' for value in results.values()) else 0


if __name__ == '__main__':
    raise SystemExit(main())
