#!/usr/bin/env python3
"""Check journal routing without starting a GNOME session or touching host settings."""

import os
import shutil
import subprocess
import tempfile
import unittest
import signal
import select
import re
import time
import uuid
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
        self.journal = self.root / "journal.txt"
        self.script = self.tools / SCRIPT.name
        # Replace only the host-specific dependency probe; execute all script logic unchanged.
        devkit = self.bin / "mutter-devkit"
        self.executable(devkit, "exit 0\n")
        self.script.write_text(SCRIPT.read_text().replace("-x /usr/lib/mutter-devkit", f'-x "{devkit}"'))
        self.script.chmod(0o755)
        shutil.copyfile(SCRIPT.parent / "dev-output.awk", self.tools / "dev-output.awk")
        self.executable(self.bin / "systemd-cat", """
printf 'journal:%s\\n' "$*" >> "$TEST_TRACE"
printf '%s\\n' $$ > "$TEST_JOURNAL_PID"
if [ "${TEST_JOURNAL_FAIL:-0}" = 1 ]; then exit 41; fi
exec cat > "$TEST_JOURNAL"
""")
        self.executable(self.bin / "meson", """
printf 'meson:%s\\n' "$*" >> "$TEST_TRACE"
printf 'build output\\n'
printf 'Installing src/sync/errors.js to extension\\n'
if [ "$1" = "${TEST_FAIL_STAGE:-compile}" ]; then exit "${TEST_BUILD_EXIT:-0}"; fi
""")
        self.executable(self.bin / "gsettings", 'printf "settings:%s\\n" "$*" >> "$TEST_TRACE"\n')
        self.executable(self.bin / "dbus-run-session", 'shift\nexec "$@"\n')
        self.executable(self.bin / "gnome-shell", """
printf 'shell:%s\\n' "$*" >> "$TEST_TRACE"
printf 'session stdout\\n'
printf 'session stderr\\n' >&2
printf 'GNOME Shell-Message: 00:00:00.000: Clipboard X [INFO] extension enable\\n'
printf '%s\\n' $$ > "$TEST_SHELL_PID"
if [ "${TEST_WAIT:-0}" = 1 ]; then exec sleep 30; fi
if [ "${TEST_INTERRUPT:-0}" = 1 ]; then kill -INT $$; fi
exit "${TEST_SESSION_EXIT:-0}"
""")
        self.env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}",
                    "TEST_TRACE": str(self.trace), "XDG_RUNTIME_DIR": str(self.root / "runtime"),
                    "TEST_JOURNAL": str(self.journal),
                    "TEST_JOURNAL_PID": str(self.root / "journal.pid"),
                    "TEST_SHELL_PID": str(self.root / "shell.pid"),
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

    def run_script(self, *arguments, **environment):
        return subprocess.run([str(self.script), *arguments], env={**self.env, **environment},
                              capture_output=True, text=True, check=False, timeout=10)

    def test_journal_wrapper_runs_once_and_keeps_isolation(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = self.trace.read_text().splitlines()
        journal = [line for line in lines if line.startswith("journal:")]
        self.assertEqual(len(journal), 1)
        self.assertIn("--identifier=clipboard-x-devkit --priority=info", journal[0])
        self.assertTrue(any(line.startswith("settings:set org.gnome.shell enabled-extensions") for line in lines))
        self.assertEqual(lines[-1], "shell:--devkit")
        self.assertIn("journalctl --user", result.stdout)
        self.assertIn("[BUILD] Build and packaging completed", result.stdout)
        self.assertIn("[INFO] extension enable", result.stdout)
        self.assertNotIn("GNOME Shell-Message", result.stdout)
        self.assertNotIn("Installing", result.stdout)
        self.assertNotIn("build output", result.stdout)
        self.assertNotIn("session stdout", result.stdout)
        self.assertNotIn("session stderr", result.stdout)
        journal_text = self.journal.read_text()
        self.assertEqual(journal_text.count("build output"), 3)
        for message in ["session stdout", "session stderr", "Clipboard X [INFO] extension enable"]:
            self.assertEqual(journal_text.count(message), 1)
        self.assertNotIn("logs are displayed", journal_text)
        self.assertNotRegex(result.stdout + result.stderr + journal_text, r"[\u3400-\u9fff]",
                            "development diagnostics must use English regardless of the system locale")
        self.assert_process_gone(self.root / "journal.pid")
        self.assertFalse((self.root / "build with spaces/logs").exists())

    def test_build_failure_keeps_exit_status_and_does_not_start_shell(self):
        for stage in ["setup", "compile", "install"]:
            with self.subTest(stage=stage):
                self.trace.unlink(missing_ok=True)
                result = self.run_script(TEST_BUILD_EXIT="37", TEST_FAIL_STAGE=stage)
                self.assertEqual(result.returncode, 37)
                self.assertIn("[ERROR] Build failed", result.stdout)
                self.assertNotIn("shell:", self.trace.read_text())
                self.assertNotIn("Build and packaging completed", result.stdout)

    def test_session_failure_keeps_exit_status(self):
        result = self.run_script(TEST_SESSION_EXIT="29")
        self.assertEqual(result.returncode, 29)
        self.assertIn("[ERROR] Development session exited · exit 29", result.stderr)

    def test_isolation_path_conflict_is_visible(self):
        extension = self.root / "runtime/clipboard-x-devkit/data/gnome-shell/extensions/clipboard-x@guleoo.github.io"
        extension.mkdir(parents=True)
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("[ERROR] Isolated extension path already exists", result.stdout)
        self.assertNotIn("shell:", self.trace.read_text())

    def test_interrupt_keeps_signal_status(self):
        self.assertIn(self.run_script(TEST_INTERRUPT="1").returncode, (-2, 130))

    def test_missing_journal_tool_leaves_terminal_output_available(self):
        (self.bin / "systemd-cat").unlink()
        for name in ["env", "bash", "dirname", "mkdir", "ln", "awk"]:
            (self.bin / name).symlink_to(shutil.which(name))
        self.env["PATH"] = str(self.bin)
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("systemd-cat", result.stderr)
        self.assertIn("[INFO] extension enable", result.stdout)
        self.assertNotIn("session stdout", result.stdout)
        self.assertNotIn("journal:", self.trace.read_text())

    def assert_process_gone(self, path):
        with self.assertRaises(ProcessLookupError):
            os.kill(int(path.read_text()), 0)

    def test_journal_failure_does_not_abort_the_session(self):
        result = self.run_script(TEST_JOURNAL_FAIL="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("[INFO] extension enable", result.stdout)
        self.assertIn("Journal forwarding failed", result.stderr)
        self.assert_process_gone(self.root / "journal.pid")

    def test_gjs_console_reaches_terminal_and_journal_once(self):
        self.executable(self.bin / "gnome-shell", """
exec gjs -c 'const GLib = imports.gi.GLib;
print("stderr-is-journal=" + GLib.log_writer_is_journald(2));
console.log("Clipboard X [INFO] gjs-stream-log");
console.warn("Clipboard X [WARN] gjs-stream-warning");
console.error("Clipboard X [ERROR] gjs-stream-error");'
""")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("stderr-is-journal=false", self.journal.read_text())
        for marker in ["gjs-stream-log", "gjs-stream-warning", "gjs-stream-error"]:
            self.assertEqual(result.stdout.count(marker), 1)
            self.assertEqual(self.journal.read_text().count(marker), 1)

    @unittest.skipUnless(os.environ.get("CBX_TEST_REAL_JOURNAL") == "1",
                         "requires explicit access to the host journal")
    def test_real_journal_receives_each_gjs_message_once(self):
        (self.bin / "systemd-cat").unlink()
        marker = f"cbx-terminal-probe-{uuid.uuid4()}"
        self.executable(self.bin / "gnome-shell", f"""
exec gjs -c 'console.log("Clipboard X [INFO] {marker}-log");
console.warn("Clipboard X [WARN] {marker}-warning");
console.error("Clipboard X [ERROR] {marker}-error");'
""")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("Journal forwarding failed", result.stderr)
        deadline = time.monotonic() + 3
        while True:
            query = subprocess.run(["journalctl", "--user", "-b", "-o", "cat",
                                    "--no-pager", "-t", "clipboard-x-devkit", "--grep", marker],
                                   capture_output=True, text=True, check=False)
            if query.stdout.count(marker) >= 3 or time.monotonic() >= deadline:
                break
            time.sleep(0.05)
        self.assertEqual(query.returncode, 0, query.stderr)
        for suffix in ["log", "warning", "error"]:
            self.assertEqual(result.stdout.count(f"{marker}-{suffix}"), 1)
            self.assertEqual(query.stdout.count(f"{marker}-{suffix}"), 1)

    def test_ctrl_c_stops_the_session_and_journal_writer(self):
        process = subprocess.Popen([str(self.script)],
                                   env={**self.env, "TEST_WAIT": "1"},
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, start_new_session=True)
        try:
            deadline = time.monotonic() + 5
            shell_pid = self.root / "shell.pid"
            journal_pid = self.root / "journal.pid"
            while True:
                try:
                    published_pids = [path.read_text() for path in (shell_pid, journal_pid)]
                except FileNotFoundError:
                    published_pids = []
                # A complete PID line is the readiness marker, not file creation.
                if len(published_pids) == 2 and all(
                        re.fullmatch(r"[1-9][0-9]*\n", pid) for pid in published_pids):
                    break
                if time.monotonic() >= deadline:
                    self.fail("mock Shell and journal writer must publish complete PIDs before interruption")
                time.sleep(0.01)
            os.killpg(process.pid, signal.SIGINT)
            process.communicate(timeout=5)
            self.assertEqual(process.returncode, 130)
            self.assert_process_gone(shell_pid)
            self.assert_process_gone(journal_pid)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()

    def test_unisolated_inner_invocation_is_still_rejected(self):
        result = self.run_script(CLIPBOARD_X_DEV_SESSION="1", XDG_CONFIG_HOME="/invalid")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.trace.exists())

    def test_verbose_keeps_the_original_stream(self):
        result = self.run_script("--verbose")
        self.assertEqual(result.returncode, 0, result.stderr)
        for message in ["build output", "Installing", "session stdout", "session stderr", "GNOME Shell-Message"]:
            self.assertIn(message, result.stdout)

    def test_system_errors_remain_visible_and_repeats_are_folded(self):
        self.executable(self.bin / "gnome-shell", """
printf 'dbus-daemon: Successfully activated service\\n'
printf 'Gtk-WARNING: Failed to open display\\n'
printf 'JS ERROR: ReferenceError: example is not defined\\n'
printf 'dbus-run-session: dbus-daemon exited with code 1\\n'
printf 'Segmentation fault (core dumped)\\n'
printf '(gnome-shell:123): Gjs-CRITICAL: Object St.Label (0x123), has been already disposed\\n'
printf '#0 resource:///org/gnome/shell/ui/main.js:123\\n'
printf '(gnome-shell:123): Gjs-CRITICAL: Object St.BoxLayout (0x456), has been already disposed\\n'
""")
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Failed to open display", result.stdout)
        self.assertIn("JS ERROR: ReferenceError", result.stdout)
        self.assertIn("dbus-daemon exited with code 1", result.stdout)
        self.assertIn("Segmentation fault (core dumped)", result.stdout)
        self.assertEqual(result.stdout.count("UI object already disposed"), 1)
        self.assertIn("1 repeated system messages hidden", result.stdout)
        self.assertNotIn("#0", result.stdout)
        self.assertNotIn("Successfully activated", result.stdout)
        self.assertIn("#0", self.journal.read_text())
        self.assertEqual(self.journal.read_text().count("already disposed"), 2)

    def test_formatter_failure_keeps_the_error_status(self):
        self.executable(self.bin / "awk", "exit 19\n")
        result = self.run_script()
        self.assertEqual(result.returncode, 19)
        self.assertIn("switching to raw output", result.stderr)
        self.assertIn("session stdout", result.stdout)
        self.assert_process_gone(self.root / "journal.pid")

    def test_formatter_failure_keeps_live_output_for_a_running_session(self):
        self.executable(self.bin / "awk", "exit 19\n")
        process = subprocess.Popen([str(self.script)],
                                   env={**self.env, "TEST_WAIT": "1"},
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, start_new_session=True)
        try:
            deadline = time.monotonic() + 5
            shell_pid = self.root / "shell.pid"
            while not shell_pid.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(shell_pid.exists())
            live_output = ""
            while "session stdout" not in live_output and time.monotonic() < deadline:
                if select.select([process.stdout], [], [], 0.1)[0]:
                    chunk = os.read(process.stdout.fileno(), 4096)
                    if not chunk:
                        break
                    live_output += chunk.decode()
            self.assertIn("session stdout", live_output,
                          "raw fallback must be visible before the session stops")
            # Stop only the mock Shell to finish the stream and reap the wrapper.
            os.kill(int(shell_pid.read_text()), signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 143)
            self.assertIn("switching to raw output", stderr)
            self.assertIn("session stdout", live_output + stdout)
            self.assert_process_gone(shell_pid)
            self.assert_process_gone(self.root / "journal.pid")
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.communicate()

    def test_help_and_unknown_options_do_not_start_a_session(self):
        self.assertIn("--verbose", self.run_script("--help").stdout)
        self.assertEqual(self.run_script("--invalid").returncode, 2)
        self.assertFalse(self.trace.exists())


if __name__ == "__main__":
    unittest.main()
