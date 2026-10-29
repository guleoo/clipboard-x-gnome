#!/usr/bin/env python3
"""Run headless sync HTTP acceptance against an owned, disposable backend.

Production GJS runs without GNOME Shell, GTK, displays or a session bus.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from simulation_runtime import UUID, fingerprint

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / 'tests/logic/sync/integration/backend.test.js'


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('archive', type=Path, nargs='?')
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'clipboard-x-server')
    parser.add_argument('--image', help='Use an already-built server image instead of building')
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
    if not args.image and not (args.source / 'docker/Dockerfile').is_file():
        parser.error('Server source or --image is required')
    for name in ['docker', 'gjs', 'timeout', 'glib-compile-schemas']:
        if not shutil.which(name):
            parser.error(f'Missing dependency: {name}')
    with owned_server(args) as env:
        return run_cases(args, selected, env)


@contextmanager
def owned_server(args):
    token = secrets.token_hex(8)
    name = f'cbx-simulation-{token}'
    volume = f'{name}-storage'
    image = args.image or f'cbx-simulation-server:{token}'
    created_image = False
    created_volume = False
    created_container = False
    env = dict(os.environ, CBX_ADMIN_USERNAME='simulation', CBX_ADMIN_PASSWORD=secrets.token_urlsafe(24))
    run = lambda command, **kwargs: subprocess.run(command, check=True, **kwargs)
    try:
        run(['docker', 'info'], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if not args.image:
            run(['docker', 'build', '-f', str(args.source / 'docker/Dockerfile'), '-t', image, str(args.source)])
            created_image = True
        run(['docker', 'volume', 'create', volume], stdout=subprocess.DEVNULL)
        created_volume = True
        run(['docker', 'create', '--name', name, '--publish', '127.0.0.1::28787',
             '--mount', f'type=volume,src={volume},dst=/app/storage',
             '-e', 'CBX_ADMIN_USERNAME', '-e', 'CBX_ADMIN_PASSWORD', '-e', 'CBX_COOKIE_SECURE=false',
             '-e', 'CBX_TLS_CERT_FILE=', '-e', 'CBX_TLS_KEY_FILE=', '-e', 'CBX_PUBLIC_ORIGIN=', image],
            env=env, stdout=subprocess.DEVNULL)
        created_container = True
        # Pagination needs >200 actual publications (several requests each).
        # Configure only this owned fixture, never weaken the deployed defaults
        # or silently retry 429s and call that a successful client operation.
        with tempfile.TemporaryDirectory(prefix='cbx-server-config-') as temporary:
            configuration_file = Path(temporary) / 'config.yaml'
            run(['docker', 'cp', f'{name}:/app/storage/config.yaml', str(configuration_file)])
            contents = configuration_file.read_text()
            if re.search(r'^http\s*:', contents, re.M):
                raise RuntimeError('Test image already defines http options; provide the standard server fixture image')
            configuration_file.write_text(contents + '\nhttp:\n  rate-limit:\n    limit: 20000\n    window: 60\n')
            run(['docker', 'cp', str(configuration_file), f'{name}:/app/storage/config.yaml'])
        run(['docker', 'start', name], stdout=subprocess.DEVNULL)
        configuration = json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
        port = configuration['NetworkSettings']['Ports']['28787/tcp'][0]['HostPort']
        address = f'http://127.0.0.1:{port}'
        deadline = time.monotonic() + 60
        while True:
            try:
                with urllib.request.urlopen(address + '/api/v1/status', timeout=2) as response:
                    ready = response.status < 500
            except urllib.error.HTTPError as error:
                ready = error.code in [401, 403]  # The API is ready and correctly requires a key.
            except (OSError, TimeoutError):
                ready = False
            if ready:
                break
            if time.monotonic() > deadline:
                run(['docker', 'logs', name])
                raise RuntimeError('Isolated clipboard-x-server did not become ready')
            time.sleep(0.2)
        env.update(CBX_SIMULATION_SERVER=address, CBX_SIMULATION_ADMIN=env['CBX_ADMIN_USERNAME'],
                   CBX_SIMULATION_PASSWORD=env['CBX_ADMIN_PASSWORD'], CBX_SIMULATION_SERVER_IMAGE=configuration['Image'])
        print(f'Isolated server ready: {address}; container={name}; fixture request limit=20000/60s', flush=True)
        yield env
    finally:
        # Exact resources created by this invocation only; never prune Docker.
        if created_container:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL)
        if created_volume:
            subprocess.run(['docker', 'volume', 'rm', volume], stdout=subprocess.DEVNULL)
        if created_image:
            subprocess.run(['docker', 'image', 'rm', image], stdout=subprocess.DEVNULL)


def run_cases(args, selected, server_env):
    args.output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report = Path(tempfile.mkdtemp(prefix=f'sync-http-{stamp}-', dir=args.output)).resolve()
    archive_bytes = args.archive.read_bytes()
    source_hash = fingerprint(ROOT)
    revision = (subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True,
                               capture_output=True).stdout.strip() or None) if shutil.which('git') else None
    results = {}
    with tempfile.TemporaryDirectory(prefix='cbx-sync-http-') as temporary:
        runtime = Path(temporary)
        extension = runtime / 'extension'
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            metadata = json.loads(archive.read('metadata.json'))
            if metadata.get('uuid') != UUID:
                raise SystemExit('Unexpected extension UUID')
            for member in archive.infolist():
                path = PurePosixPath(member.filename)
                if path.is_absolute() or '..' in path.parts or member.external_attr >> 16 & 0o170000 == 0o120000:
                    raise SystemExit('Unsafe archive member')
            archive.extractall(extension)
        subprocess.run(['glib-compile-schemas', '--strict', str(extension / 'schemas')], check=True)
        for index, key in enumerate(selected):
            if key == 'XFER-09-sha256sum' and not shutil.which('sha256sum'):
                results[key] = {'status': 'BLOCKED', 'reason': 'Missing sha256sum'}
                continue
            session = runtime / str(index)
            session.mkdir(mode=0o700)
            env = dict(server_env, GSETTINGS_BACKEND='memory', GIO_USE_VFS='local',
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
                'testsRevision': revision, 'testsFingerprint': source_hash,
                'serverImage': server_env.get('CBX_SIMULATION_SERVER_IMAGE'), 'results': results}
    (report / 'report.json').write_text(json.dumps(document, indent=2) + '\n')
    print(f'Report: {report}')
    if any(value['status'] in ['FAIL', 'NOT_RUN'] for value in results.values()):
        return 1
    return 2 if any(value['status'] == 'BLOCKED' for value in results.values()) else 0


if __name__ == '__main__':
    sys.exit(main())
