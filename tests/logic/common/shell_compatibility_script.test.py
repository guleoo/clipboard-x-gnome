#!/usr/bin/env python3
"""Test version guards and isolated headless invocation without starting a desktop."""

import json
import os
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "tools/test-shell-compatibility.sh"


class ShellCompatibilityScriptTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="cbx shell wrapper ")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.archive = self.root / "release with spaces.zip"
        with zipfile.ZipFile(self.archive, "w") as archive:
            archive.writestr("metadata.json", json.dumps({"shell-version": ["50", "51"]}))
            archive.writestr("extension.js", b"extension fixture")
        self.original_archive = self.archive.read_bytes()
        self.test_archive = self.root / "tested.zip"
        self.trace = self.root / "trace"
        self.executable("gnome-shell", 'printf "GNOME Shell %s.0\\n" "$CBX_TEST_SHELL"\n')
        self.executable("dbus-run-session", 'shift\nexec "$@"\n')
        self.executable("gnome-shell-test-tool", """
printf '%s\\n' "$XDG_RUNTIME_DIR" "${DISPLAY-unset}" "${WAYLAND_DISPLAY-unset}" \
  "${GDK_BACKEND-unset}" "${GSETTINGS_SCHEMA_DIR-unset}" "$LIBGL_ALWAYS_SOFTWARE" \
  "$GTK_A11Y" "$NO_AT_BRIDGE" "$@" > "$CBX_TEST_TRACE"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--extension" ]; then
    cp -- "$2" "$CBX_TEST_ARCHIVE"
    break
  fi
  shift
done
exit "${CBX_TEST_EXIT:-0}"
""")
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "CBX_TEST_TRACE": str(self.trace), "CBX_TEST_SHELL": "50",
                    "CBX_TEST_ARCHIVE": str(self.test_archive),
                    "DISPLAY": ":42", "WAYLAND_DISPLAY": "host-display",
                    "GDK_BACKEND": "x11", "GSETTINGS_SCHEMA_DIR": "/host/schemas"}

    def executable(self, name, body):
        path = self.bin / name
        path.write_text("#!/bin/sh\n" + body)
        path.chmod(0o755)

    def run_script(self, expected, **environment):
        return subprocess.run(["bash", str(SCRIPT), str(self.archive), expected],
                              env={**self.env, **environment}, capture_output=True,
                              text=True, timeout=10)

    def test_both_versions_use_isolated_runtime_and_quoted_archive(self):
        for version in ("50", "51"):
            with self.subTest(version=version):
                result = self.run_script(version, CBX_TEST_SHELL=version)
                self.assertEqual(result.returncode, 0, result.stderr)
                lines = self.trace.read_text().splitlines()
                self.assertNotEqual(lines[0], self.env.get("XDG_RUNTIME_DIR"))
                self.assertFalse(Path(lines[0]).exists(), "private runtime must be cleaned up")
                self.assertEqual(lines[1:5], ["unset"] * 4)
                arguments = lines[8:]
                self.assertIn("--headless", arguments)
                self.assertIn("--disable-animations", arguments)
                self.assertEqual(arguments[arguments.index("--extension") + 1], str(self.archive))
                self.assertEqual(self.test_archive.read_bytes(), self.original_archive,
                                 "the release ZIP must be tested byte-for-byte unchanged")

    def test_rejects_wrong_or_unsupported_runtime(self):
        for runtime, expected in (("50", "51"), ("51", "50"), ("52", "52")):
            with self.subTest(runtime=runtime, expected=expected):
                result = self.run_script(expected, CBX_TEST_SHELL=runtime)
                self.assertEqual(result.returncode, 1)
                self.assertFalse(self.trace.exists(), "version mismatch must not start Shell")

    def test_propagates_shell_failure_and_cleans_runtime(self):
        for version in ("50", "51"):
            with self.subTest(version=version):
                result = self.run_script(version, CBX_TEST_SHELL=version, CBX_TEST_EXIT="17")
                self.assertEqual(result.returncode, 17)
                runtime = self.trace.read_text().splitlines()[0]
                self.assertFalse(Path(runtime).exists())
                self.assertEqual(self.archive.read_bytes(), self.original_archive)


if __name__ == "__main__":
    unittest.main()
