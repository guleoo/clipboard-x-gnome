"""Shared package preparation and owned filesystem lifetime for local simulations."""
from contextlib import contextmanager
import json
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile

UUID = 'clipboard-x-gnome@guleoo.github.io'


def snapshot(root, destination):
    paths = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--cached', '--others',
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
        source = root / path
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


def fingerprint(root):
    digest = hashlib.sha256()
    paths = [path for path in (root / 'tests').rglob('*') if path.is_file()
             and path.suffix in {'.js', '.py', '.sh', '.json', '.base64'}]
    paths += [*root.glob('tools/test-*.py'), *root.glob('tools/test-*.sh'), root / 'tools/simulation_runtime.py']
    for path in sorted(set(paths)):
        digest.update(str(path.relative_to(root)).encode() + b'\0')
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


@contextmanager
def private_directory():
    directory = Path(tempfile.mkdtemp(prefix='clipboard-x-simulation-'))
    try:
        yield directory
    finally:
        for _attempt in range(50):
            result = subprocess.run(['rm', '-rf', '--one-file-system', '--', str(directory)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                break
            time.sleep(0.1)
        else:
            print(f'Warning: private runtime cleanup incomplete: {directory}', file=sys.stderr)


def prepare_archive(source_path, destination, major):
    with zipfile.ZipFile(source_path) as source, zipfile.ZipFile(destination, 'w') as target:
        metadata = json.loads(source.read('metadata.json'))
        if metadata['uuid'] != UUID:
            raise ValueError('Unexpected extension UUID')
        if major not in metadata['shell-version']:
            if major != '51':
                raise ValueError('Release package does not support the requested Shell')
            metadata['shell-version'].append('51')
        for entry in source.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Archive contains an unsafe member path')
            contents = source.read(entry)
            if entry.filename == 'metadata.json':
                contents = (json.dumps(metadata, indent=2) + '\n').encode()
            target.writestr(entry, contents)
    return metadata
