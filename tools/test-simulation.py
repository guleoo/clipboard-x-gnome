#!/usr/bin/env python3
"""Local real-desktop acceptance; deliberately separate from ordinary CI."""
import argparse
from contextlib import contextmanager
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests/simulation'


@contextmanager
def private_runtime():
    path = Path(tempfile.mkdtemp(prefix='clipboard-x-simulation-'))
    try:
        yield path
    finally:
        # Private portal helpers may be unmounting gvfs/doc after their bus exits.
        # Do not traverse those mounts or turn a transient mount race into a test failure.
        for _attempt in range(50):
            result = subprocess.run(['rm', '-rf', '--one-file-system', '--', str(path)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                break
            time.sleep(0.1)
        else:
            print(f'Warning: private runtime cleanup incomplete: {path}', file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, nargs='?')
    parser.add_argument('--case', help='Comma-separated acceptance IDs')
    parser.add_argument('--group', help='Comma-separated domain names')
    parser.add_argument('--shell', choices=['50', '51'])
    parser.add_argument('--language', default='en_US', help='Gettext language for the isolated processes')
    parser.add_argument('--output', type=Path, default=ROOT / 'build/simulation-tests')
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--isolate-cases', action='store_true', help='Start a fresh Shell per case, continuing after failures')
    args = parser.parse_args()
    registry = json.loads((TESTS / 'manifest.json').read_text())
    available = {case['id']: (group['module'], case) for group in registry for case in group['cases']}
    selected = args.case.split(',') if args.case else list(available)
    if args.group:
        groups = args.group.split(',')
        selected = [key for key in selected if available.get(key, ('',))[0].split('/')[0] in groups]
        known_groups = {module.split('/')[0] for module, _ in available.values()}
        if set(groups) - known_groups:
            parser.error('Unknown group')
    if not selected or set(selected) - available.keys() or len(set(selected)) != len(selected):
        parser.error('Empty, duplicate or unknown case selection')
    if args.list:
        for key in selected:
            module, case = available[key]
            print(f'{key}: {module}' + (f"; requires {', '.join(case.get('commands', []))}" if case.get('commands') else ''))
        return 0
    if not args.archive or not args.archive.is_file():
        parser.error('A built release ZIP is required')
    if not 1 <= args.timeout <= 7200 or not re.fullmatch(r'[A-Za-z_0-9.@-]+', args.language):
        parser.error('Invalid timeout or language')
    for dependency in ['gnome-shell', 'gnome-shell-test-tool', 'dbus-run-session', 'timeout']:
        if not shutil.which(dependency):
            parser.error(f'Missing dependency: {dependency}')
    shell = subprocess.check_output(['gnome-shell', '--version'], text=True).strip()
    match = re.fullmatch(r'GNOME Shell (50|51)(?:\..*)?', shell)
    if not match or args.shell and args.shell != match[1]:
        parser.error(f'Unsupported or unexpected runtime: {shell}')
    args.output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report = Path(tempfile.mkdtemp(prefix=f'gnome{match[1]}-{stamp}-', dir=args.output)).resolve()
    results = {}
    modules = defaultdict(list)
    for key in selected:
        module, case = available[key]
        missing = [name for name in case.get('commands', []) if not shutil.which(name)]
        if missing:
            results[key] = {'status': 'BLOCKED', 'reason': 'Missing: ' + ', '.join(missing)}
        else:
            modules[(module, key if args.isolate_cases else '')].append(key)
    with private_runtime() as runtime:
        archive = runtime / 'extension.zip'
        with zipfile.ZipFile(args.archive) as source, zipfile.ZipFile(archive, 'w') as target:
            metadata = json.loads(source.read('metadata.json'))
            if metadata['uuid'] != 'clipboard-x-gnome@guleoo.github.io':
                parser.error('Unexpected extension UUID')
            if match[1] not in metadata['shell-version']:
                if match[1] != '51':
                    parser.error('Package does not support the requested runtime')
                metadata['shell-version'].append('51')
            for item in source.infolist():
                contents = source.read(item)
                if item.filename == 'metadata.json':
                    contents = (json.dumps(metadata, indent=2) + '\n').encode()
                target.writestr(item, contents)
        import base64
        background = runtime / 'background.png'
        background.write_bytes(base64.b64decode((TESTS / 'panels/fixtures/background.png.base64').read_bytes()))
        for index, ((module, isolated_case), cases) in enumerate(modules.items()):
            session = runtime / str(index)
            session.mkdir(mode=0o700)
            env = dict(os.environ, XDG_RUNTIME_DIR=str(session), TMPDIR=str(session),
                       CBX_SIMULATION_RUNTIME=str(session), CBX_SIMULATION_MODULE=module,
                       CBX_SIMULATION_CASES=','.join(cases), LIBGL_ALWAYS_SOFTWARE='1',
                       GTK_A11Y='none', NO_AT_BRIDGE='1', SHELL_BACKGROUND_IMAGE=str(background),
                       XDG_CURRENT_DESKTOP='GNOME', XDG_SESSION_TYPE='wayland', LANGUAGE=args.language,
                       LANG='C.UTF-8', LC_ALL='C.UTF-8', PYTHONUNBUFFERED='1')
            for name in ['DISPLAY', 'WAYLAND_DISPLAY', 'GDK_BACKEND', 'GSETTINGS_SCHEMA_DIR', 'GSETTINGS_BACKEND']:
                env.pop(name, None)
            log = report / (module.replace('/', '-').removesuffix('.js') + (f'-{isolated_case}' if isolated_case else '') + '.log')
            command = ['timeout', '--kill-after=10s', f'{args.timeout}s', 'dbus-run-session', '--',
                       'gnome-shell-test-tool', '--headless', '--disable-animations',
                       '--extra-filter', 'Gjs', '--extra-filter', 'gjs', '--extension', str(archive),
                       str(TESTS / 'acceptance.smoke.js')]
            with log.open('w') as output:
                status = subprocess.run(command, env=env, stdout=output, stderr=subprocess.STDOUT).returncode
            contents = log.read_text(errors='replace')
            for key in cases:
                passed = re.search(rf'^\[simulation\] PASS {re.escape(key)}$', contents, re.M)
                failed = re.search(rf'^\[simulation\] FAIL {re.escape(key)}:', contents, re.M)
                outcome = 'PASS' if passed else 'FAIL' if failed else 'NOT_RUN'
                results[key] = {'status': outcome, 'log': log.name}
            complete = f'[simulation] COMPLETE {module}: {len(cases)} cases' in contents
            if status != 0 or not complete:
                results[f'RUNNER:{module}:{isolated_case}'] = {'status': 'FAIL', 'reason': f'Exit {status}; complete={complete}', 'log': log.name}
            print(f'{module}: exit {status}; {log}', flush=True)
            for key in cases:
                print(f"  {results[key]['status']} {key}", flush=True)
    document = {'shell': shell, 'archive': str(args.archive.resolve()),
                'sha256': hashlib.sha256(args.archive.read_bytes()).hexdigest(), 'language': args.language,
                'results': results}
    (report / 'report.json').write_text(json.dumps(document, indent=2) + '\n')
    (report / 'summary.txt').write_text('\n'.join(f"{value['status']} {key} {value.get('reason', '')}" for key, value in results.items()) + '\n')
    print(f'Report: {report}')
    if any(value['status'] in ['FAIL', 'NOT_RUN'] for value in results.values()):
        return 1
    return 2 if any(value['status'] == 'BLOCKED' for value in results.values()) else 0


if __name__ == '__main__':
    sys.exit(main())
