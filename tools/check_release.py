#!/usr/bin/env python3
"""Check that a release tag and ZIP describe the same, minimal extension."""

import argparse
import json
import re
import stat
import zipfile
from pathlib import Path


class ReleaseError(Exception):
    pass


def _version(project_root):
    package = json.loads((project_root / "package.json").read_text(encoding="utf-8"))
    meson = (project_root / "meson.build").read_text(encoding="utf-8")
    match = re.search(
        r"project\(\s*'clipboard-x-gnome'\s*,\s*version:\s*'([^']+)'",
        meson,
    )
    if not match:
        raise ReleaseError("Could not read the Meson project version")
    version = match.group(1)
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ReleaseError(f"Release version must be X.Y.Z: {version}")
    if package.get("version") != version:
        raise ReleaseError("package.json and meson.build versions differ")
    return version


def _expected_files(project_root):
    source = project_root / "src"
    files = {
        path.relative_to(source).as_posix()
        for path in source.rglob("*")
        if path.is_file()
        and not path.relative_to(source).as_posix().startswith(
            "clipboard/tokenizer/dictionary/seeds/"
        )
    }
    files.update(
        {
            "metadata.json",
            "stylesheet.css",
            "schemas/org.gnome.shell.extensions.clipboard-x.gschema.xml",
            "schemas/gschemas.compiled",
        }
    )
    languages = (
        (project_root / "po/LINGUAS").read_text(encoding="utf-8").splitlines()
    )
    files.update(
        f"locale/{language.strip()}/LC_MESSAGES/clipboard-x.mo"
        for language in languages
        if language.strip() and not language.lstrip().startswith("#")
    )
    return files


def validate(project_root, archive, tag=None):
    project_root = Path(project_root)
    version = _version(project_root)
    if tag is not None and tag != f"v{version}":
        raise ReleaseError(f"Tag {tag} does not match project version v{version}")

    expected = _expected_files(project_root)
    with zipfile.ZipFile(archive) as package:
        names = []
        for entry in package.infolist():
            name = entry.filename
            path_name = name[:-1] if entry.is_dir() else name
            parts = path_name.split("/")
            if name.startswith("/") or "\\" in name or any(
                part in ("", ".", "..") for part in parts
            ):
                raise ReleaseError(f"Unsafe archive path: {name}")
            if stat.S_IFMT(entry.external_attr >> 16) == stat.S_IFLNK:
                raise ReleaseError(f"Archive contains a symbolic link: {name}")
            if not entry.is_dir():
                if entry.file_size == 0:
                    raise ReleaseError(f"Archive contains an empty file: {name}")
                names.append(name)
        if len(names) != len(set(names)):
            raise ReleaseError("Archive contains duplicate files")
        missing = expected - set(names)
        extra = set(names) - expected
        if missing or extra:
            raise ReleaseError(
                f"Archive file mismatch; missing={sorted(missing)}, extra={sorted(extra)}"
            )
        damaged = package.testzip()
        if damaged:
            raise ReleaseError(f"Archive checksum failed: {damaged}")
        metadata = json.loads(package.read("metadata.json"))

    if metadata.get("uuid") != "clipboard-x@guleoo.github.io":
        raise ReleaseError("Extension UUID is incorrect")
    if metadata.get("settings-schema") != "org.gnome.shell.extensions.clipboard-x":
        raise ReleaseError("Extension settings schema is incorrect")
    if metadata.get("version-name") != version:
        raise ReleaseError("metadata.json version-name differs from the project version")
    if "version" in metadata:
        raise ReleaseError("metadata.json must not set the EGO-managed numeric version")
    if metadata.get("shell-version") != ["50"]:
        raise ReleaseError("Release metadata must declare the tested GNOME Shell 50")
    return version


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--tag", help="Release tag, for example v1.0.0")
    arguments = parser.parse_args()
    try:
        version = validate(Path(__file__).resolve().parent.parent, arguments.archive, arguments.tag)
    except (OSError, ValueError, zipfile.BadZipFile, ReleaseError) as error:
        parser.exit(1, f"Release check failed: {error}\n")
    print(f"Release ZIP and version v{version} verified: {arguments.archive}")


if __name__ == "__main__":
    main()
