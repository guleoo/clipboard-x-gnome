#!/usr/bin/env python3
"""Build/reuse isolated GNOME environments; prefer logic to desktop simulation."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
DEFINITION = ROOT / 'tests/environments'
LABEL = 'io.github.guleoo.clipboard-x-gnome.test-environment'


def snapshot(destination):
    paths = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '--cached', '--others',
                                     '--exclude-standard', '-z']).decode().split('\0')
    trees = {'src', 'data', 'schemas', 'po', 'tests', 'tools', 'docs'}
    files = {'meson.build', 'meson_options.txt', 'package.json', 'LICENSE'}
    digest = hashlib.sha256()
    for name in sorted(set(paths) - {''}):
        path = Path(name)
        if path.parts[0] not in trees and name not in files and not name.startswith(('README', 'CONTRIBUTING')):
            continue
        if name == 'tools/simulate-input-sample.txt':
            continue
        source = ROOT / path
        if not source.is_file():
            continue
        if source.is_symlink():
            raise ValueError(f'Snapshot refuses a source symlink: {name}')
        content = source.read_bytes()
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o444 | (source.stat().st_mode & 0o111))
        digest.update(name.encode() + b'\0' + hashlib.sha256(content).digest())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--shell', choices=['50', '51', 'all'], default='all')
    parser.add_argument('--suite', choices=['logic', 'simulation'], default='logic')
    parser.add_argument('--case', help='Explicit desktop case IDs; required with --suite simulation')
    parser.add_argument('--language', default='en_US')
    parser.add_argument('--display', choices=['standard', 'dual', 'fractional'], default='standard')
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--rebuild', action='store_true', help='Explicitly refresh package layers; otherwise reuse the fixed image')
    parser.add_argument('--context', help='Docker context; omitted uses the configured default')
    args = parser.parse_args()
    if args.suite == 'simulation' and not args.case and not args.build_only:
        parser.error('Specify --case; full-matrix/server orchestration is not implemented by this environment tool')
    if args.suite == 'logic' and args.case:
        parser.error('--case requires --suite simulation')
    if not 1 <= args.timeout <= 7200:
        parser.error('--timeout must be between 1 and 7200 seconds')
    if args.case:
        registry = json.loads((ROOT / 'tests/simulation/manifest.json').read_text())
        available = {case['id']: case for group in registry for case in group['cases']}
        selected = args.case.split(',')
        if len(selected) != len(set(selected)) or any(case not in available for case in selected):
            parser.error('Unknown or duplicate simulation case')
        if any(available[case].get('server') for case in selected):
            parser.error('This network-isolated environment has no sync server; use the separate owned-server runner')
    if not shutil.which('docker'):
        parser.error('Docker is required')
    docker = ['docker', *(['--context', args.context] if args.context else [])]
    subprocess.run([*docker, 'info'], check=True, stdout=subprocess.DEVNULL)
    majors = ['50', '51'] if args.shell == 'all' else [args.shell]
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    (ROOT / 'build').mkdir(exist_ok=True)
    report = Path(tempfile.mkdtemp(prefix=f'environments-{stamp}-', dir=ROOT / 'build'))
    revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    results = {}
    with tempfile.TemporaryDirectory(prefix='cbx-environment-source-') as temporary:
        source = Path(temporary)
        source.chmod(0o755)
        source_hash = snapshot(source)
        for major in majors:
            dockerfile = f'gnome{major}/Dockerfile'
            definition_hash = hashlib.sha256(b''.join(
                name.encode() + b'\0' + (DEFINITION / name).read_bytes()
                for name in [dockerfile, 'session.py']
            )).hexdigest()
            base = next(line.removeprefix('FROM ').strip()
                        for line in (DEFINITION / dockerfile).read_text().splitlines()
                        if line.startswith('FROM '))
            tag = f'clipboard-x-gnome-test:{major}'
            inspected = subprocess.run([*docker, 'image', 'inspect', tag], capture_output=True, text=True)
            if inspected.returncode == 0:
                existing = json.loads(inspected.stdout)[0]
                labels = existing['Config'].get('Labels') or {}
                if labels.get(LABEL) != '1':
                    raise ValueError(f'Refuse to overwrite an unrelated image: {tag}')
                if labels.get(LABEL + '.definition') != definition_hash and not args.rebuild:
                    raise ValueError(f'{tag} uses a different environment definition; rebuild explicitly with --rebuild')
            if inspected.returncode or args.rebuild:
                command = [*docker, 'build', '--file', str(DEFINITION / dockerfile),
                           '--label', f'{LABEL}.definition={definition_hash}', '-t', tag]
                if args.rebuild:
                    command.append('--no-cache')
                print(f'Building GNOME {major} environment...', flush=True)
                log = report / f'gnome{major}-image.log'
                with log.open('w') as output:
                    built = subprocess.run([*command, str(DEFINITION)], stdout=output, stderr=subprocess.STDOUT)
                if built.returncode:
                    print(log.read_text(errors='replace')[-6000:], file=sys.stderr)
                    raise RuntimeError(f'GNOME {major} image build failed; see {log}')
            image = json.loads(subprocess.check_output([*docker, 'image', 'inspect', tag]))[0]
            image_id = image['Id']
            results[major] = {'image': image_id, 'base': base, 'sourceSha256': source_hash,
                              'definitionSha256': definition_hash}
            if args.build_only:
                results[major]['status'] = 'BUILT'
                continue
            name = f'cbx-test-{major}-{uuid.uuid4().hex[:12]}'
            destination = report / f'gnome{major}'
            request = {'suite': args.suite, 'case': args.case, 'language': args.language,
                       'display': args.display, 'timeout': args.timeout}
            command = [*docker, 'create', '--name', name, '--init', '--network', 'none',
                       '--shm-size', '512m', '--pids-limit', '2048', '--ulimit', 'core=0']
            browser = bool(args.case and {'CLIP-02-chromium', 'TYPE-09-chromium', 'TYPE-09-firefox'}
                           .intersection(args.case.split(',')))
            if browser:
                # Chromium's own namespace sandbox needs clone/unshare denied by
                # Docker's default seccomp. Never use privileged mode/no-sandbox.
                command += ['--security-opt', 'seccomp=unconfined']
            results[major]['browserNamespaces'] = browser
            command += [image_id, json.dumps(request)]
            try:
                subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
                # Copy, never mount host paths or depend on Docker Desktop file sharing.
                subprocess.run([*docker, 'cp', str(source), f'{name}:/workspace'], check=True)
                status = subprocess.run([*docker, 'start', '-a', name]).returncode
                # Docker start's status is not always the workload status.
                state = json.loads(subprocess.check_output([*docker, 'inspect', name]))[0]['State']
                status = status or state['ExitCode']
                copied = subprocess.run([*docker, 'cp', f'{name}:/home/tester/results', str(destination)])
                if copied.returncode or not (destination / 'environment.json').is_file():
                    status = status or 1
                outcome = 'PASS' if status == 0 else 'BLOCKED' if status == 2 else 'FAIL'
                results[major].update(status=outcome, exitCode=status)
                with (report / f'gnome{major}-container.log').open('w') as output:
                    subprocess.run([*docker, 'logs', name], stdout=output, stderr=subprocess.STDOUT)
            finally:
                subprocess.run([*docker, 'rm', '-f', name], stdout=subprocess.DEVNULL)
    (report / 'report.json').write_text(json.dumps({'suite': args.suite, 'revision': revision,
                                                 'results': results}, indent=2) + '\n')
    print(f'Report: {report}')
    if any(item['status'] == 'FAIL' for item in results.values()):
        return 1
    return 2 if any(item['status'] == 'BLOCKED' for item in results.values()) else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Environment setup failed: {error}', file=sys.stderr)
        sys.exit(1)
