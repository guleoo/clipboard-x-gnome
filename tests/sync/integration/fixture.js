import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish_utf8');
Gio._promisify(Gio.Subprocess.prototype, 'wait_check_async', 'wait_check_finish');

export class HttpFixture {
  constructor() {
    const directory = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    this._process = Gio.Subprocess.new([
      GLib.getenv('CBX_TEST_PYTHON') ?? 'python3',
      GLib.build_filenamev([directory, 'http_fixture.py']),
    ], Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
  }

  async start() {
    const output = new Gio.DataInputStream({base_stream: this._process.get_stdout_pipe()});
    const [line] = await output.read_line_async(GLib.PRIORITY_DEFAULT, null);
    if (!line)
      throw new Error('HTTP fixture exited without publishing its loopback address');
    return JSON.parse(line).address;
  }

  async close() {
    this._process.get_stdin_pipe().close(null);
    await this._process.wait_check_async(null);
  }
}
