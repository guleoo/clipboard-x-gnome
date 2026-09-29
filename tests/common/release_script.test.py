#!/usr/bin/env python3
"""Check the local release command's safe defaults and publish guard."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "tools/release.sh"


class ReleaseScriptTest(unittest.TestCase):
    def run_script(self, path, *arguments):
        return subprocess.run(
            ["bash", str(path), *arguments],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_shell_syntax(self):
        subprocess.run(["bash", "-n", str(SCRIPT)], check=True)

    def test_help_describes_safe_local_default(self):
        result = self.run_script(SCRIPT, "--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("Nothing is\ninstalled", result.stdout)
        self.assertIn("--publish", result.stdout)

    def test_remote_option_requires_explicit_publish(self):
        result = self.run_script(SCRIPT, "--remote", "origin")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--remote requires --publish", result.stderr)

    def test_remote_option_requires_a_name(self):
        result = self.run_script(SCRIPT, "--remote", "")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--remote needs a remote name", result.stderr)

    def test_unknown_option_fails_before_build(self):
        result = self.run_script(SCRIPT, "--unknown")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unknown option", result.stderr)

    def test_publish_refuses_dirty_worktree_before_build(self):
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            (project / "tools").mkdir()
            copied_script = project / "tools/release.sh"
            shutil.copyfile(SCRIPT, copied_script)
            subprocess.run(["git", "init", "-q", str(project)], check=True)
            (project / "untracked.txt").write_text("dirty", encoding="utf-8")
            result = self.run_script(copied_script, "--publish")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("working-tree changes", result.stderr)
            self.assertFalse((project / "build").exists())


if __name__ == "__main__":
    unittest.main()
