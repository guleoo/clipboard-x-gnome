#!/usr/bin/env python3
"""Direct checks for the release ZIP and version gate."""

import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


CHECKER = Path(__file__).resolve().parents[2] / "tools/check_release.py"
SPEC = importlib.util.spec_from_file_location("check_release", CHECKER)
check_release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check_release)


class ReleasePackageTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "src").mkdir()
        (self.root / "po").mkdir()
        (self.root / "src/extension.js").write_text("export default class Extension {}\n")
        (self.root / "src/prefs.js").write_text("export default class Preferences {}\n")
        (self.root / "po/LINGUAS").write_text("zh_CN\n")
        (self.root / "meson.build").write_text(
            "project('clipboard-x-gnome', version: '0.1.0')\n"
        )
        (self.root / "package.json").write_text(json.dumps({"version": "0.1.0"}))
        self.archive = self.root / "extension.zip"
        self.files = {
            "extension.js": b"extension",
            "prefs.js": b"preferences",
            "metadata.json": json.dumps(
                {
                    "uuid": "clipboard-x@guleo.github.io",
                    "settings-schema": "org.gnome.shell.extensions.clipboard-x",
                    "version-name": "0.1.0",
                    "shell-version": ["50"],
                }
            ).encode(),
            "stylesheet.css": b".panel { color: white; }",
            "schemas/org.gnome.shell.extensions.clipboard-x.gschema.xml": b"<schema/>",
            "schemas/gschemas.compiled": b"compiled",
            "locale/zh_CN/LC_MESSAGES/clipboard-x.mo": b"translation",
        }

    def write_archive(self):
        with zipfile.ZipFile(self.archive, "w") as package:
            for name, contents in self.files.items():
                package.writestr(name, contents)

    def test_accepts_complete_archive_and_matching_tag(self):
        self.write_archive()
        self.assertEqual(check_release.validate(self.root, self.archive, "v0.1.0"), "0.1.0")

    def test_rejects_wrong_tag(self):
        self.write_archive()
        with self.assertRaisesRegex(check_release.ReleaseError, "does not match"):
            check_release.validate(self.root, self.archive, "v0.2.0")

    def test_rejects_mismatched_source_versions(self):
        (self.root / "package.json").write_text(json.dumps({"version": "0.2.0"}))
        self.write_archive()
        with self.assertRaisesRegex(check_release.ReleaseError, "versions differ"):
            check_release.validate(self.root, self.archive)

    def test_rejects_missing_runtime_file(self):
        del self.files["schemas/gschemas.compiled"]
        self.write_archive()
        with self.assertRaisesRegex(check_release.ReleaseError, "missing="):
            check_release.validate(self.root, self.archive)

    def test_rejects_non_runtime_file(self):
        self.files["tests/clipboard.test.js"] = b"not for release"
        self.write_archive()
        with self.assertRaisesRegex(check_release.ReleaseError, "extra="):
            check_release.validate(self.root, self.archive)

    def test_rejects_archive_path_escape(self):
        self.files["../escape"] = b"unwanted"
        self.write_archive()
        with self.assertRaisesRegex(check_release.ReleaseError, "Unsafe archive path"):
            check_release.validate(self.root, self.archive)

    def test_rejects_malformed_directory_path(self):
        self.write_archive()
        with zipfile.ZipFile(self.archive, "a") as package:
            package.writestr("bad//", b"")
        with self.assertRaisesRegex(check_release.ReleaseError, "Unsafe archive path"):
            check_release.validate(self.root, self.archive)

    def test_rejects_wrong_metadata_version(self):
        metadata = json.loads(self.files["metadata.json"])
        metadata["version-name"] = "0.2.0"
        self.files["metadata.json"] = json.dumps(metadata).encode()
        self.write_archive()
        with self.assertRaisesRegex(check_release.ReleaseError, "version-name differs"):
            check_release.validate(self.root, self.archive)

    def test_rejects_ego_managed_numeric_version(self):
        metadata = json.loads(self.files["metadata.json"])
        metadata["version"] = 1
        self.files["metadata.json"] = json.dumps(metadata).encode()
        self.write_archive()
        with self.assertRaisesRegex(check_release.ReleaseError, "EGO-managed"):
            check_release.validate(self.root, self.archive)


if __name__ == "__main__":
    unittest.main()
