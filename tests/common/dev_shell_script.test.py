#!/usr/bin/env python3
"""Check journal routing without starting a GNOME session or touching host settings."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[2] / "tools/run-dev-shell.sh"


class DevShellScriptTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="cbx dev shell ")
        self.root = Path(self.temporary.name)
        self.tools = self.root / "tools"
        self.tools.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.trace = self.root / "commands.txt"
        self.script = self.tools / SCRIPT.name
        # Replace only the host-specific dependency probe; execute all script logic unchanged.
        devkit = self.bin / "mutter-devkit"
        self.executable(devkit, "exit 0\n")
        self.script.write_text(SCRIPT.read_text().replace("-x /usr/lib/mutter-devkit", f'-x "{devkit}"'))
        self.script.chmod(0o755)
        self.executable(self.bin / "systemd-cat", """
printf 'journal:%s\\n' "$*" >> "$TEST_TRACE"
while [ "${1#--}" != "$1" ]; do shift; done
exec "$@"
""")
        self.executable(self.bin / "meson", """
printf 'meson:%s\\n' "$*" >> "$TEST_TRACE"
printf 'build output\\n'
if [ "$1" = "compile" ]; then exit "${TEST_BUILD_EXIT:-0}"; fi
""")
        self.executable(self.bin / "gsettings", 'printf "settings:%s\\n" "$*" >> "$TEST_TRACE"\n')
        self.executable(self.bin / "dbus-run-session", 'shift\nexec "$@"\n')
        self.executable(self.bin / "gnome-shell", """
printf 'shell:%s\\n' "$*" >> "$TEST_TRACE"
printf 'session stdout\\n'
printf 'session stderr\\n' >&2
if [ "${TEST_INTERRUPT:-0}" = 1 ]; then kill -INT $$; fi
exit "${TEST_SESSION_EXIT:-0}"
""")
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "TEST_TRACE": str(self.trace), "XDG_RUNTIME_DIR": str(self.root / "runtime"),
                    "CLIPBOARD_X_DEV_BUILD_DIR": str(self.root / "build with spaces")}
        self.env.pop("CLIPBOARD_X_DEV_SESSION", None)
        self.env.pop("CLIPBOARD_X_DEV_JOURNAL", None)
        self.env.pop("CLIPBOARD_X_DEV_ROOT", None)

    def tearDown(self):
        self.temporary.cleanup()

    @staticmethod
    def executable(path, body):
        path.write_text("#!/bin/sh\n" + body)
        path.chmod(0o755)

    def run_script(self, **environment):
        return subprocess.run([str(self.script)], env={**self.env, **environment},
                              capture_output=True, text=True, check=False, timeout=10)

    def test_journal_wrapper_runs_once_and_keeps_isolation(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = self.trace.read_text().splitlines()
        journal = [line for line in lines if line.startswith("journal:")]
        self.assertEqual(len(journal), 1)
        self.assertIn("--identifier=clipboard-x-devkit --priority=info --stderr-priority=warning", journal[0])
        self.assertTrue(any(line.startswith("settings:set org.gnome.shell enabled-extensions") for line in lines))
        self.assertEqual(lines[-1], "shell:--devkit")
        self.assertIn("journalctl --user", result.stdout)
        self.assertIn("build output", result.stdout)
        self.assertIn("session stdout", result.stdout)
        self.assertIn("session stderr", result.stderr)
        self.assertFalse((self.root / "build with spaces/logs").exists())

    def test_build_failure_keeps_exit_status_and_does_not_start_shell(self):
        result = self.run_script(TEST_BUILD_EXIT="37")
        self.assertEqual(result.returncode, 37)
        self.assertNotIn("shell:", self.trace.read_text())

    def test_session_failure_keeps_exit_status(self):
        self.assertEqual(self.run_script(TEST_SESSION_EXIT="29").returncode, 29)

    def test_interrupt_keeps_signal_status(self):
        self.assertIn(self.run_script(TEST_INTERRUPT="1").returncode, (-2, 130))

    def test_missing_journal_tool_leaves_terminal_output_available(self):
        (self.bin / "systemd-cat").unlink()
        for name in ["env", "bash", "dirname", "mkdir", "ln"]:
            (self.bin / name).symlink_to(shutil.which(name))
        self.env["PATH"] = str(self.bin)
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("systemd-cat", result.stderr)
        self.assertIn("session stdout", result.stdout)
        self.assertNotIn("journal:", self.trace.read_text())

    def test_unisolated_inner_invocation_is_still_rejected(self):
        result = self.run_script(CLIPBOARD_X_DEV_SESSION="1", XDG_CONFIG_HOME="/invalid")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.trace.exists())


if __name__ == "__main__":
    unittest.main()
