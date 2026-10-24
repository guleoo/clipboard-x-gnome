#!/usr/bin/env python3
"""Cold Shell recovery and offline package replacement, never host installation."""
import argparse
import base64
from configparser import ConfigParser
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
import zipfile
from simulation_runtime import UUID, fingerprint, prepare_archive, private_directory

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--previous', type=Path, help='Previous package for an actual version upgrade; defaults to reinstalling the same ZIP')
    parser.add_argument('--shell', choices=['50', '51'])
    parser.add_argument('--output', type=Path, default=ROOT / 'build/lifecycle-tests')
    args = parser.parse_args()
    for dependency in ['gnome-shell', 'gnome-extensions', 'dbus-run-session', 'dbus-update-activation-environment', 'gsettings', 'timeout']:
        if not shutil.which(dependency): parser.error(f'Missing dependency: {dependency}')
    shell = subprocess.check_output(['gnome-shell', '--version'], text=True).strip()
    match = re.fullmatch(r'GNOME Shell (50|51)(?:\..*)?', shell)
    if not match or args.shell and args.shell != match[1]: parser.error(f'Unexpected runtime: {shell}')
    if not args.archive.is_file() or args.previous and not args.previous.is_file(): parser.error('Package does not exist')
    args.output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    report = Path(tempfile.mkdtemp(prefix=f'gnome{match[1]}-{stamp}-', dir=args.output)).resolve()
    results = {}
    current_bytes = args.archive.read_bytes()
    previous_bytes = (args.previous or args.archive).read_bytes()
    source_hash = fingerprint(ROOT)
    with private_directory() as runtime:
        current_source = runtime / 'current-source.zip'
        previous_source = runtime / 'previous-source.zip'
        current_source.write_bytes(current_bytes)
        previous_source.write_bytes(previous_bytes)
        current = runtime / 'current.zip'
        previous = runtime / 'previous.zip'
        prepare_archive(current_source, current, match[1])
        prepare_archive(previous_source, previous, match[1])
        prepared = {'seed': hashlib.sha256(previous.read_bytes()).hexdigest(),
                    'restore': hashlib.sha256(current.read_bytes()).hexdigest()}
        env = dict(os.environ, CBX_SIMULATION_RUNTIME=str(runtime), CBX_SIMULATION_COLD_STATE=str(runtime / 'state.json'),
                   XDG_RUNTIME_DIR=str(runtime), TMPDIR=str(runtime), XDG_DATA_HOME=str(runtime / 'data'),
                   XDG_CONFIG_HOME=str(runtime / 'config'), XDG_CACHE_HOME=str(runtime / 'cache'),
                   XDG_STATE_HOME=str(runtime / 'state'), GSETTINGS_BACKEND='keyfile',
                   LIBGL_ALWAYS_SOFTWARE='1', GTK_A11Y='none', NO_AT_BRIDGE='1',
                   XDG_CURRENT_DESKTOP='GNOME', XDG_SESSION_TYPE='wayland', LANG='C.UTF-8', LC_ALL='C.UTF-8', LANGUAGE='en_US')
        for key in ['DISPLAY', 'WAYLAND_DISPLAY', 'GDK_BACKEND', 'GSETTINGS_SCHEMA_DIR']:
            env.pop(key, None)
        background = runtime / 'background.png'
        background.write_bytes(base64.b64decode((ROOT / 'tests/simulation/panels/fixtures/background.png.base64').read_bytes()))
        env['SHELL_BACKGROUND_IMAGE'] = str(background)
        settings = runtime / 'config/glib-2.0/settings/keyfile'
        settings.parent.mkdir(parents=True)
        configuration = ConfigParser()
        configuration['org/gnome/shell'] = {'enabled-extensions': json.dumps([UUID])}
        configuration['org/gnome/desktop/interface'] = {'enable-animations': 'false'}
        with settings.open('w') as output: configuration.write(output)
        for phase, archive in [('seed', previous), ('restore', current)]:
            install_log = report / f'{phase}-install.log'
            with install_log.open('w') as output:
                status = subprocess.run(['dbus-run-session', '--', 'gnome-extensions', 'install', '--force', str(archive)],
                                        env=env, stdout=output, stderr=subprocess.STDOUT).returncode
            if status: results[phase] = f'FAIL install exit {status}'; break
            installed = runtime / 'data/gnome-shell/extensions' / UUID
            try:
                with zipfile.ZipFile(archive) as package:
                    for entry in package.infolist():
                        if not entry.is_dir() and (installed / entry.filename).read_bytes() != package.read(entry):
                            raise RuntimeError(f'Installed artifact differs: {entry.filename}')
            except (OSError, RuntimeError) as error:
                results[phase] = f'FAIL installed artifact verification: {error}'
                results['ENV-02'] = 'FAIL'
                print(results[phase], file=sys.stderr)
                break
            log = report / f'{phase}.log'
            command = ['timeout', '--kill-after=10s', '90s', 'dbus-run-session', '--', sys.executable,
                       str(ROOT / 'tests/fixtures/shell-session.py'), 'gnome-shell', '--headless', '--virtual-monitor', '1280x720',
                       '--wayland-display', 'cbx-cold-display', '--automation-script', str(ROOT / 'tests/simulation/lifecycle/cold.smoke.js')]
            with log.open('w') as output:
                status = subprocess.run(command, env=dict(env, CBX_SIMULATION_COLD_PHASE=phase),
                                        stdout=output, stderr=subprocess.STDOUT).returncode
            expected = '[lifecycle] SEEDED' if phase == 'seed' else '[lifecycle] PASS ENV-06'
            results[phase] = 'PASS' if status == 0 and expected in log.read_text(errors='replace') else f'FAIL exit {status}'
            print(f'{phase}: {results[phase]}; {log}', flush=True)
            if results[phase] != 'PASS': break
        if results.get('restore') == 'PASS': results['ENV-02'] = results['ENV-06'] = 'PASS'
    if fingerprint(ROOT) != source_hash: results['sources'] = 'FAIL tests changed during this run'
    document = {'shell': shell, 'sha256': hashlib.sha256(current_bytes).hexdigest(),
                'testsFingerprint': source_hash,
                'preparedSha256': prepared,
                'previousSha256': hashlib.sha256(previous_bytes).hexdigest(),
                'replacement': 'version upgrade' if args.previous else 'same-package reinstall', 'results': results}
    (report / 'report.json').write_text(json.dumps(document, indent=2) + '\n')
    print(f'Report: {report}')
    return 0 if results.get('ENV-06') == 'PASS' and 'sources' not in results else 1


if __name__ == '__main__': sys.exit(main())
