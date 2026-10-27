"""Bootstrap only a disposable container, then run tests as an ordinary user."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def run(command, log):
    with log.open('w') as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT)
    print(f'{log.name}: exit {result.returncode}', flush=True)
    if result.returncode:
        print(log.read_text(errors='replace')[-6000:], flush=True)
    return result.returncode


def main():
    if os.getuid() != 0 or not Path('/.dockerenv').is_file():
        raise RuntimeError('This bootstrap is only for the owned Docker test container')
    request = json.loads(sys.argv[1])
    bus = Path('/run/dbus')
    bus.mkdir(parents=True, exist_ok=True)
    subprocess.run(['dbus-daemon', '--system', '--fork', '--nopidfile'], check=True)
    # No host logind exists in this private container.
    seats = Path('/run/systemd/seats')
    if seats.is_dir():
        seats.rmdir()
    x11 = Path('/tmp/.X11-unix')
    x11.mkdir(exist_ok=True)
    x11.chmod(0o1777)
    os.setgroups([])
    os.setgid(1000)
    os.setuid(1000)
    os.environ.update(HOME='/home/tester', USER='tester', LOGNAME='tester')
    project = Path('/home/tester/project')
    shutil.copytree('/workspace', project)
    os.chdir(project)
    results = Path('/home/tester/results')
    results.mkdir()
    versions = {'shell': subprocess.check_output(['gnome-shell', '--version'], text=True).strip(),
                'gjs': subprocess.check_output(['gjs', '--version'], text=True).strip(),
                'inputMethod': os.environ['GTK_IM_MODULE'],
                'uid': os.getuid(), 'suite': request['suite']}
    (results / 'environment.json').write_text(json.dumps(versions, indent=2) + '\n')
    shutil.copyfile('/opt/test-packages.txt', results / 'packages.txt')
    if versions['shell'].split()[-1].split('.')[0] != os.environ['CBX_TEST_SHELL']:
        raise RuntimeError('Container Shell version does not match the selected environment')
    print(json.dumps(versions), flush=True)
    for label, command in [
        ('configure', ['meson', 'setup', 'build', '-Dtarget=package']),
        ('build', ['meson', 'compile', '-C', 'build']),
    ]:
        status = run(command, results / f'{label}.log')
        if status:
            return status
    if request['suite'] == 'logic':
        status = run(['dbus-run-session', '--', 'meson', 'test', '-C', 'build',
                      '--no-suite', 'stress', '--print-errorlogs'], results / 'logic.log')
        acceptance = run(['bash', 'tools/test-logic-acceptance.sh'], results / 'logic-acceptance.log')
        shutil.copytree('build/meson-logs', results / 'meson-logs')
        return status or acceptance
    status = run(['meson', 'install', '-C', 'build'], results / 'package.log')
    if status:
        return status
    version = json.loads(Path('package.json').read_text())['version']
    archive = f'build/clipboard-x-gnome_{version}.zip'
    command = ['python3', 'tools/test-simulation.py', archive, '--shell', os.environ['CBX_TEST_SHELL'],
               '--case', request['case'], '--language', request['language'], '--display', request['display'],
               '--timeout', str(request['timeout']), '--isolate-cases', '--output', str(results / 'simulation')]
    return run(command, results / 'simulation.log')


if __name__ == '__main__':
    sys.exit(main())
