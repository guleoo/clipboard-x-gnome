#!/usr/bin/env python3
"""Local real-desktop acceptance; deliberately separate from ordinary CI."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
import locale
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from simulation_runtime import check_archive, fingerprint, private_directory

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / 'tests/simulation'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path, nargs='?')
    parser.add_argument('--case', help='Comma-separated acceptance IDs')
    parser.add_argument('--shell', choices=['50', '51'])
    parser.add_argument('--language', default='en_US', help='Gettext language for the isolated processes')
    parser.add_argument('--output', type=Path, default=ROOT / 'build/simulation-tests')
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--isolate-cases', action='store_true', help='Start a fresh Shell per case instead of one shared Shell')
    args = parser.parse_args()
    registry = json.loads((TESTS / 'manifest.json').read_text())
    available = {case['id']: group['module'] for group in registry for case in group['cases']}
    selected = args.case.split(',') if args.case else list(available)
    if not selected or set(selected) - available.keys() or len(set(selected)) != len(selected):
        parser.error('Empty, duplicate or unknown case selection')
    if args.list:
        for key in selected:
            print(f'{key}: {available[key]}')
        return 0
    if not args.archive or not args.archive.is_file():
        parser.error('A built release ZIP is required')
    if not 1 <= args.timeout <= 86400 or not re.fullmatch(r'[A-Za-z_0-9.@-]+', args.language):
        parser.error('Invalid timeout or language')
    for dependency in ['gnome-shell', 'gnome-shell-test-tool', 'dbus-run-session', 'dbus-update-activation-environment', 'gsettings', 'timeout', 'locale']:
        if not shutil.which(dependency):
            parser.error(f'Missing dependency: {dependency}')
    shell = subprocess.check_output(['gnome-shell', '--version'], text=True).strip()
    match = re.fullmatch(r'GNOME Shell (50|51)(?:\..*)?', shell)
    if not match or args.shell and args.shell != match[1]:
        parser.error(f'Unsupported or unexpected runtime: {shell}')
    # gettext ignores LANGUAGE in a C message locale, including C.UTF-8.
    # Prefer a real requested locale: LANGUAGE alone selects translations, but
    # cannot establish all Shell/GTK locale-dependent layout behavior (RTL).
    # A non-C fallback still permits catalog smoke tests on minimal systems.
    message_locale = 'C.UTF-8'
    requested = args.language.split('.')[0].split('@')[0].lower()
    installed = subprocess.check_output(['locale', '-a'], text=True).splitlines()
    matching = [name for name in installed if name.split('.')[0].lower() == requested
                or '_' not in requested and name.lower().startswith(requested + '_')]
    for candidate in [args.language + '.UTF-8', *sorted(matching),
                      'en_US.UTF-8', os.environ.get('LC_ALL'), os.environ.get('LANG')]:
        if not candidate or candidate.upper().startswith('C.') or 'utf8' not in candidate.lower().replace('-', ''):
            continue
        try:
            locale.setlocale(locale.LC_MESSAGES, candidate)
            message_locale = candidate
            break
        except locale.Error:
            continue
    if not args.language.startswith('en') and message_locale == 'C.UTF-8':
        parser.error('Missing a generated non-C UTF-8 locale (for example en_US.UTF-8)')
    args.output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report = Path(tempfile.mkdtemp(prefix=f'gnome{match[1]}-{stamp}-', dir=args.output)).resolve()
    archive_bytes = args.archive.read_bytes()
    archive_hash = hashlib.sha256(archive_bytes).hexdigest()
    source_hash = fingerprint(ROOT)
    revision = None
    if shutil.which('git'):
        revision = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True, capture_output=True).stdout.strip() or None
    results = {}
    sessions = defaultdict(list)
    for key in selected:
        sessions[key if args.isolate_cases else 'all'].append(key)
    with private_directory() as runtime:
        # Test a private copy so the input ZIP may change while the Shell runs.
        archive = runtime / 'extension.zip'
        archive.write_bytes(archive_bytes)
        check_archive(archive, match[1])
        import base64
        background = runtime / 'background.png'
        background.write_bytes(base64.b64decode((TESTS / 'panels/fixtures/background.png.base64').read_bytes()))
        wrapper = runtime / 'session.py'
        shutil.copyfile(ROOT / 'tests/fixtures/shell-session.py', wrapper)
        for index, (session_name, cases) in enumerate(sessions.items()):
            session = runtime / str(index)
            session.mkdir(mode=0o700)
            artifacts = report / f'artifacts-{index}'
            artifacts.mkdir()
            env = dict(os.environ, XDG_RUNTIME_DIR=str(session), TMPDIR=str(session),
                       XDG_STATE_HOME=str(session / 'state'),
                       CBX_SIMULATION_RUNTIME=str(session),
                       CBX_SIMULATION_CASES=','.join(cases), LIBGL_ALWAYS_SOFTWARE='1',
                       CBX_SIMULATION_ARTIFACTS=str(artifacts),
                       GTK_A11Y='none', NO_AT_BRIDGE='1', SHELL_BACKGROUND_IMAGE=str(background),
                       XDG_CURRENT_DESKTOP='GNOME', XDG_SESSION_TYPE='wayland', LANGUAGE=args.language,
                       LANG=message_locale, LC_ALL=message_locale, PYTHONUNBUFFERED='1')
            for name in ['DISPLAY', 'WAYLAND_DISPLAY', 'GDK_BACKEND', 'GSETTINGS_SCHEMA_DIR', 'GSETTINGS_BACKEND']:
                env.pop(name, None)
            log = report / f'{session_name}.log'
            command = ['timeout', '--kill-after=10s', f'{args.timeout}s', 'dbus-run-session', '--',
                       'gnome-shell-test-tool', '--headless', '--disable-animations',
                       '--wrap', f'{sys.executable} {wrapper}',
                       '--extra-filter', 'Gjs', '--extra-filter', 'gjs',
                       '--extension', str(archive),
                       str(TESTS / 'acceptance.smoke.js')]
            with log.open('w') as output:
                status = subprocess.run(command, env=env, stdout=output, stderr=subprocess.STDOUT).returncode
            contents = log.read_text(errors='replace')
            for key in cases:
                passed = re.search(rf'^\[simulation\] PASS {re.escape(key)}$', contents, re.M)
                failed = re.search(rf'^\[simulation\] FAIL {re.escape(key)}:', contents, re.M)
                started = re.search(rf'^\[simulation\] START {re.escape(key)}$', contents, re.M)
                blocked = re.search(rf'^\[simulation\] BLOCKED {re.escape(key)}: (.*)$', contents, re.M)
                outcome = ('PASS' if passed else 'FAIL' if failed else 'BLOCKED' if blocked
                           else 'FAIL' if started and status != 0 else 'NOT_RUN')
                results[key] = {'status': outcome, 'log': log.name}
                if blocked:
                    results[key]['reason'] = blocked[1]
            complete = f'[simulation] COMPLETE: {len(cases)} cases' in contents
            if status != 0 or not complete:
                results[f'RUNNER:{session_name}'] = {'status': 'FAIL', 'reason': f'Exit {status}; complete={complete}', 'log': log.name}
            print(f'{session_name}: exit {status}; {log}', flush=True)
            for key in cases:
                print(f"  {results[key]['status']} {key}", flush=True)
    if fingerprint(ROOT) != source_hash:
        results['RUNNER:sources'] = {'status': 'FAIL', 'reason': 'Test sources changed during this run; repeat against a stable snapshot'}
    document = {'shell': shell, 'archive': str(args.archive.resolve()), 'testsRevision': revision,
                'testsFingerprint': source_hash,
                'sha256': archive_hash, 'language': args.language,
                'messageLocale': message_locale,
                'results': results}
    (report / 'report.json').write_text(json.dumps(document, indent=2) + '\n')
    (report / 'summary.txt').write_text('\n'.join(f"{value['status']} {key} {value.get('reason', '')}" for key, value in results.items()) + '\n')
    print(f'Report: {report}')
    if any(value['status'] in ['FAIL', 'NOT_RUN'] for value in results.values()):
        return 1
    return 2 if any(value['status'] == 'BLOCKED' for value in results.values()) else 0


if __name__ == '__main__':
    sys.exit(main())
