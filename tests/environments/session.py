"""Bootstrap only a disposable container, then run tests as an ordinary user."""
import grp
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid


def startJournal():
    """The container's own real daemon, never a mounted host journal/socket."""
    Path('/etc/machine-id').write_text(uuid.uuid4().hex + '\n')
    configuration = Path('/etc/systemd/journald.conf.d/clipboard-x-test.conf')
    configuration.parent.mkdir(parents=True, exist_ok=True)
    configuration.write_text('[Journal]\nStorage=persistent\nSplitMode=uid\nReadKMsg=no\nAudit=no\n')
    Path('/var/log/journal').mkdir(parents=True, exist_ok=True)
    with Path('/tmp/clipboard-x-test-journald.log').open('w') as output:
        process = subprocess.Popen(['/usr/lib/systemd/systemd-journald'], stdout=output, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 5
    while not Path('/run/systemd/journal/stdout').exists():
        if process.poll() is not None or time.monotonic() >= deadline:
            raise RuntimeError('Private journald failed to become ready')
        time.sleep(0.02)
    subprocess.run(['journalctl', '--flush'], check=True)
    os.environ['CBX_TEST_JOURNAL'] = '1'
    return grp.getgrnam('systemd-journal').gr_gid


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
    groups = []
    if 'OPS-07-devkit' in (request.get('case') or '').split(',') and os.environ.get('CBX_TEST_PROFILE') == 'applications':
        groups.append(startJournal())
    bus = Path('/run/dbus')
    bus.mkdir(parents=True, exist_ok=True)
    if request['suite'] != 'sync-http':
        subprocess.run(['dbus-daemon', '--system', '--fork', '--nopidfile'], check=True)
    # No host logind exists in this private container.
    seats = Path('/run/systemd/seats')
    if seats.is_dir():
        seats.rmdir()
    x11 = Path('/tmp/.X11-unix')
    x11.mkdir(exist_ok=True)
    x11.chmod(0o1777)
    os.setgroups(groups)
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
                'profile': os.environ['CBX_TEST_PROFILE'],
                'uid': os.getuid(), 'suite': request['suite']}
    if versions['profile'] == 'applications':
        applications = Path('/opt/test-applications.json')
        versions['applications'] = json.loads(applications.read_text())
        shutil.copyfile(applications, results / 'applications.json')
    (results / 'environment.json').write_text(json.dumps(versions, indent=2) + '\n')
    shutil.copyfile('/opt/test-packages.txt', results / 'packages.txt')
    if versions['shell'].split()[-1].split('.')[0] != os.environ['CBX_TEST_SHELL']:
        raise RuntimeError('Container Shell version does not match the selected environment')
    print(json.dumps(versions), flush=True)
    if request.get('archive'):
        headless = request['suite'] == 'sync-http'
        runner = 'tools/test-sync-http.py' if headless else 'tools/test-simulation.py'
        output = results / ('sync-http' if headless else 'simulation')
        command = ['python3', runner, request['archive'], '--output', str(output)]
        if not headless:
            command += ['--group', 'sync', '--shell', os.environ['CBX_TEST_SHELL'], '--isolate-cases']
        return run([*command, *request['options']], results / 'acceptance.log')
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
