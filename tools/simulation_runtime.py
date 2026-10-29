"""Shared package preparation and owned filesystem lifetime for local simulations."""
from contextlib import contextmanager
import json
import hashlib
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import time
import zipfile

UUID = 'clipboard-x-gnome@guleoo.github.io'


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
