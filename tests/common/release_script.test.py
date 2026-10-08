#!/usr/bin/env python3
"""Check the local release command's safe defaults and publish guard."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "tools/release.sh"
PROJECT = SCRIPT.parent.parent


class ReleaseScriptTest(unittest.TestCase):
    @staticmethod
    def release_commands():
        lines = (PROJECT / ".github/workflows/release.yml").read_text(encoding="utf-8").splitlines()
        start = next(index for index, line in enumerate(lines)
                     if line.strip().startswith("notes_file="))
        indentation = len(lines[start]) - len(lines[start].lstrip())
        commands = []
        for line in lines[start:]:
            if line.strip() and len(line) - len(line.lstrip()) < indentation:
                break
            commands.append(line[indentation:])
        return "\n".join(commands)

    def test_release_requires_both_languages_and_publishes_only_english(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            notes = root / "docs/release"
            notes.mkdir(parents=True)
            gh = root / "gh"
            # This mock reads the supplied notes file; it never contacts GitHub.
            gh.write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_GH_CALLS"
if [[ "$1 $2" == 'release view' ]]; then exit 1; fi
if [[ "$1 $2" != 'release create' ]]; then exit 2; fi
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == '--notes-file' ]]; then cat "$2" > "$TEST_RELEASE_BODY"; exit 0; fi
  shift
done
exit 3
''', encoding="utf-8")
            gh.chmod(0o755)
            trace = root / "gh-calls.txt"
            body = root / "release-body.txt"
            env = {**os.environ, "PATH": f"{root}:{os.environ['PATH']}",
                   "GITHUB_REF_NAME": "v1.0.0", "GITHUB_REPOSITORY": "guleoo/clipboard-x-gnome",
                   "ARCHIVE_NAME": "clipboard-x-gnome_1.0.0.zip",
                   "TEST_GH_CALLS": str(trace), "TEST_RELEASE_BODY": str(body)}
            english = notes / "v1.0.0-en.md"
            chinese = notes / "v1.0.0-cn.md"
            for missing in (english, chinese):
                with self.subTest(missing=missing.name):
                    english.write_text("English release notes", encoding="utf-8")
                    chinese.write_text("Chinese release notes", encoding="utf-8")
                    missing.unlink()
                    result = subprocess.run(["bash", "-eu", "-c", self.release_commands()],
                                            cwd=root, env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn(f"Release notes are missing: docs/release/{missing.name}", result.stderr)
                    self.assertFalse(trace.exists(), "missing notes must prevent GitHub writes")
            english.write_text("English release notes", encoding="utf-8")
            chinese.write_text("Chinese release notes", encoding="utf-8")
            result = subprocess.run(["bash", "-eu", "-c", self.release_commands()],
                                    cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(body.read_text(encoding="utf-8"), english.read_text(encoding="utf-8"))

    def run_script(self, path, *arguments):
        return subprocess.run(
            ["bash", str(path), *arguments],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_remote_option_requires_explicit_publish(self):
        result = self.run_script(SCRIPT, "--remote", "origin")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--remote requires --publish", result.stderr)

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
