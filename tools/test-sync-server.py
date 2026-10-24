#!/usr/bin/env python3
"""Run native sync acceptance against an owned, disposable clipboard-x-server."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--source', type=Path, default=ROOT.parent / 'clipboard-x-server')
    parser.add_argument('--image', help='Use an already-built server image instead of building')
    parser.add_argument('--shell-container', help='Run the Shell in this GNOME test image, sharing only the owned server network')
    args, options = parser.parse_known_args()
    if not args.archive.is_file() or not args.image and not (args.source / 'docker/Dockerfile').is_file():
        parser.error('An extension ZIP and server source/image are required')
    token = secrets.token_hex(8)
    name = f'cbx-simulation-{token}'
    volume = f'{name}-storage'
    image = args.image or f'cbx-simulation-server:{token}'
    created_image = False
    created_volume = False
    created_container = False
    created_shell = False
    shell_name = f'{name}-shell'
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
        env['CBX_SIMULATION_TEST_REVISION'] = (subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'],
          text=True, capture_output=True).stdout.strip() if shutil.which('git') else '')
        print(f'Isolated server ready: {address}; container={name}', flush=True)
        if args.shell_container:
            archive = args.archive.resolve().relative_to(ROOT)
            env['CBX_SIMULATION_SERVER'] = 'http://127.0.0.1:28787'
            command = ['docker', 'create', '--name', shell_name, '--network', f'container:{name}',
                       '--mount', f'type=bind,src={ROOT},dst=/workspace,readonly', '--workdir', '/workspace']
            for key in ['CBX_SIMULATION_SERVER', 'CBX_SIMULATION_ADMIN', 'CBX_SIMULATION_PASSWORD', 'CBX_SIMULATION_SERVER_IMAGE', 'CBX_SIMULATION_TEST_REVISION']:
                command += ['-e', key]
            # Start a system bus only inside the disposable GNOME container.
            bootstrap = ('import os,pathlib,subprocess,sys;pathlib.Path("/run/dbus").mkdir(parents=True,exist_ok=True);'
                         'subprocess.run(["dbus-daemon","--system","--fork","--nopidfile"],check=True);'
                         'os.execvp("python3",["python3",*sys.argv[1:]])')
            if any(option == '--output' or option.startswith('--output=') for option in options):
                parser.error('--output is managed by the container runner')
            command += [args.shell_container, 'python3', '-c', bootstrap,
                        '/workspace/tools/test-simulation.py', f'/workspace/{archive}',
                        '--group', 'sync', '--output', '/tmp/cbx-simulation-reports', *options]
            run(command, env=env, stdout=subprocess.DEVNULL)
            created_shell = True
            subprocess.run(['docker', 'start', '-a', shell_name])
            status = int(json.loads(subprocess.check_output(['docker', 'inspect', shell_name]))[0]['State']['ExitCode'])
            reports = ROOT / 'build/simulation-tests' / shell_name
            reports.mkdir(parents=True)
            copied = subprocess.run(['docker', 'cp', f'{shell_name}:/tmp/cbx-simulation-reports/.', str(reports)])
            with (reports / 'server.log').open('w') as output:
                subprocess.run(['docker', 'logs', name], stdout=output, stderr=subprocess.STDOUT)
            print(f'Container reports: {reports}', flush=True)
            if copied.returncode or not list(reports.glob('*/report.json')):
                print('Container report export failed; the run cannot be accepted', file=sys.stderr)
                return status or 1
            return status
        return subprocess.run([sys.executable, str(ROOT / 'tools/test-simulation.py'),
                               str(args.archive), '--group', 'sync', *options], env=env).returncode
    finally:
        # Exact resources created by this invocation only; never prune Docker.
        if created_shell:
            subprocess.run(['docker', 'rm', '-f', shell_name], stdout=subprocess.DEVNULL)
        if created_container:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL)
        if created_volume:
            subprocess.run(['docker', 'volume', 'rm', volume], stdout=subprocess.DEVNULL)
        if created_image:
            subprocess.run(['docker', 'image', 'rm', image], stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    sys.exit(main())
