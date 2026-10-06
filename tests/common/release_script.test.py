#!/usr/bin/env python3
"""Check the local release command's safe defaults and publish guard."""

import json
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
        commands = []
        for line in lines[start:]:
            if line.strip() and not line.startswith(" " * 10):
                break
            commands.append(line[10:])
        return "\n".join(commands)

    def test_release_workflow_uses_prepared_english_notes(self):
        workflow = (PROJECT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        self.assertIn('notes_file="docs/release/${GITHUB_REF_NAME}-en.md"', workflow)
        self.assertIn('chinese_notes_file="docs/release/${GITHUB_REF_NAME}-cn.md"', workflow)
        self.assertIn('--notes-file "$notes_file"', workflow)
        self.assertNotIn('--generate-notes', workflow)

    def test_release_notes_path_matches_the_tag(self):
        workflow = (PROJECT / ".github/workflows/release.yml").read_text(encoding="utf-8")
        assignments = "\n".join(line.strip() for line in workflow.splitlines()
                                if line.strip().startswith(("notes_file=", "chinese_notes_file=")))
        for tag in ("v1.0.0", "v2.7.3"):
            with self.subTest(tag=tag):
                result = subprocess.run(
                    ["bash", "-c", assignments + '\n printf "%s\\n%s" "$notes_file" "$chinese_notes_file"'],
                    env={**os.environ, "GITHUB_REF_NAME": tag},
                    capture_output=True, text=True, check=True,
                )
                self.assertEqual(result.stdout, f"docs/release/{tag}-en.md\ndocs/release/{tag}-cn.md")
        version = json.loads((PROJECT / "package.json").read_text(encoding="utf-8"))["version"]
        for language in ("en", "cn"):
            self.assertTrue((PROJECT / "docs/release" / f"v{version}-{language}.md").is_file())

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
            source = PROJECT / "docs/release"
            english.write_text((source / english.name).read_text(encoding="utf-8"), encoding="utf-8")
            chinese.write_text((source / chinese.name).read_text(encoding="utf-8"), encoding="utf-8")
            result = subprocess.run(["bash", "-eu", "-c", self.release_commands()],
                                    cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(body.read_text(encoding="utf-8"), english.read_text(encoding="utf-8"))
            self.assertIn("/blob/v1.0.0/docs/release/v1.0.0-cn.md", body.read_text(encoding="utf-8"))
            self.assertNotIn("## 主要功能", body.read_text(encoding="utf-8"))

    def test_initial_release_has_language_links_and_no_changelog(self):
        for language, other in (("en", "cn"), ("cn", "en")):
            with self.subTest(language=language):
                notes = (PROJECT / f"docs/release/v1.0.0-{language}.md").read_text(encoding="utf-8")
                self.assertIn(f"https://github.com/guleoo/clipboard-x-gnome/blob/v1.0.0/docs/release/v1.0.0-{other}.md", notes)
                self.assertNotIn("Full Changelog", notes)
                self.assertNotIn("/compare/", notes)

    def test_shell_test_commands_use_the_current_versioned_archive(self):
        package = json.loads((PROJECT / "package.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temporary:
            tool = Path(temporary) / "gnome-shell-test-tool"
            tool.write_text('#!/bin/sh\nprintf "%s\\n" "$@"\n', encoding="utf-8")
            tool.chmod(0o755)
            env = {**os.environ, "PATH": f"{temporary}:{os.environ['PATH']}"}
            for name in ("test:shell", "test:device-badges"):
                with self.subTest(script=name):
                    result = subprocess.run(
                        package["scripts"][name], shell=True, cwd=PROJECT,
                        env=env, capture_output=True, text=True, check=True,
                    )
                    arguments = result.stdout.splitlines()
                    self.assertEqual(
                        arguments[arguments.index("--extension") + 1],
                        f"build/clipboard-x-gnome_{package['version']}.zip",
                    )

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
