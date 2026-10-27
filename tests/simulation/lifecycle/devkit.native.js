import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';
import {assert, block, pause, until, UUID} from '../helpers/desktop.js';
import {withCleanup} from '../helpers/resources.js';
import {screenshot} from '../helpers/diagnostics.js';

const text = path => new TextDecoder().decode(Gio.File.new_for_path(path).load_contents(null)[1]);
function spawn(argv, output, environment = {}) {
  const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDERR_MERGE});
  launcher.set_stdout_file_path(output);
  for (const [name, value] of Object.entries(environment)) launcher.setenv(name, value, true);
  return launcher.spawnv(argv);
}
async function command(argv) {
  const process = Gio.Subprocess.new(argv, Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
  return new Promise((resolve, reject) => process.communicate_utf8_async(null, null, (child, result) => {
    try {
      const [, stdout, stderr] = child.communicate_utf8_finish(result);
      assert(child.get_successful(), `Observer command failed: ${argv[0]} (${stderr})`);
      resolve(stdout);
    } catch (error) { reject(error); }
  }));
}
function call(connection, destination, path, iface, method, parameters, reply) {
  return new Promise((resolve, reject) => connection.call(destination, path, iface, method,
    parameters, new GLib.VariantType(reply), Gio.DBusCallFlags.NONE, 2000, null, (source, result) => {
      try { resolve(source.call_finish(result).deepUnpack()); } catch (error) { reject(error); }
    }));
}
async function connect(address) {
  return new Promise((resolve, reject) => Gio.DBusConnection.new_for_address(address,
    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION,
    null, null, (_source, result) => {
      try { resolve(Gio.DBusConnection.new_for_address_finish(result)); } catch (error) { reject(error); }
    }));
}
async function close(connection) {
  if (!connection || connection.is_closed()) return;
  await new Promise((resolve, reject) => connection.close(null, (source, result) => {
    try { source.close_finish(result); resolve(); } catch (error) { reject(error); }
  }));
}
async function stop(process) {
  if (!process) return;
  process.send_signal(15);
  await new Promise((resolve, reject) => process.wait_async(null, (child, result) => {
    try { child.wait_finish(result); resolve(); } catch (error) { reject(error); }
  }));
}

export const cases = {
  async 'OPS-07-devkit'(desktop) {
    if (GLib.getenv('CBX_TEST_JOURNAL') !== '1')
      block('Use the applications container bootstrap with its own persistent user journal');
    assert(/^zh(?:_|$)/.test(GLib.getenv('LANGUAGE') ?? ''), 'Devkit acceptance requires the actual requested Chinese locale');
    const runtime = GLib.getenv('CBX_SIMULATION_RUNTIME');
    const artifacts = GLib.getenv('CBX_SIMULATION_ARTIFACTS');
    const root = `${runtime}/devkit`;
    const build = `${runtime}/devkit-build`;
    const terminal = `${artifacts}/devkit-terminal.log`;
    const project = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent().get_parent().get_path();
    const outerIdentity = desktop.settings.get_string('device-id');
    const previousWindows = new Set(global.get_window_actors().map(actor => actor.meta_window));
    let pipewire;
    let wireplumber;
    let process;
    let window;
    let connection;
    let exited = false;
    let pendingExit;
    let shellPid;
    await withCleanup(async () => {
      if (!Gio.File.new_for_path(`${GLib.getenv('XDG_RUNTIME_DIR')}/pipewire-0`).query_exists(null)) {
        pipewire = spawn(['pipewire'], `${artifacts}/devkit-pipewire.log`);
        await until(() => Gio.File.new_for_path(`${GLib.getenv('XDG_RUNTIME_DIR')}/pipewire-0`).query_exists(null),
          'real private PipeWire socket', 10000);
      }
      // A pre-existing private PipeWire socket does not imply a session policy
      // manager. Headless containers have no systemd user session to start one.
      wireplumber = spawn(['wireplumber'], `${artifacts}/devkit-wireplumber.log`);
      process = spawn(['bash', `${project}/tools/run-dev-shell.sh`], terminal, {
        CLIPBOARD_X_GNOME_DEV_ROOT: root, CLIPBOARD_X_GNOME_DEV_BUILD_DIR: build,
        LANGUAGE: 'zh_CN', MUTTER_WM_CLASS_FILTER: '',
      });
      pendingExit = new Promise((resolve, reject) => process.wait_async(null, (child, result) => {
        try { child.wait_finish(result); exited = true; resolve(); } catch (error) { reject(error); }
      }));
      await until(() => {
        window = global.get_window_actors().map(actor => actor.meta_window).find(candidate => !previousWindows.has(candidate)
          && /org\.gnome\.Mutter\.Mdk/i.test(candidate.get_wm_class() ?? ''));
        return Boolean(window) || exited;
      }, 'actual Mutter Devkit window after a fresh real build', 60000);
      assert(window && !exited, 'The unmodified development script must create a real Devkit window');
      shellPid = Number(text(`/proc/${window.get_pid()}/status`).match(/^PPid:\s+(\d+)$/mu)?.[1]);
      const environment = Object.fromEntries(text(`/proc/${shellPid}/environ`).split('\0').filter(Boolean)
        .map(value => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]));
      assert(text(`/proc/${shellPid}/cmdline`).includes('--devkit') && environment.CLIPBOARD_X_GNOME_DEV_ROOT === root
        && environment.XDG_CONFIG_HOME === `${root}/config` && environment.XDG_DATA_HOME === `${root}/data`
        && environment.XDG_CACHE_HOME === `${root}/cache` && environment.XDG_STATE_HOME === `${root}/state`
        && environment.LANGUAGE === 'zh_CN' && environment.GSETTINGS_BACKEND === 'keyfile',
      'The real inner Shell must use only this test configuration/data and requested language');
      assert(environment.DBUS_SESSION_BUS_ADDRESS !== GLib.getenv('DBUS_SESSION_BUS_ADDRESS'),
        'The inner Shell must not reuse the outer session bus');
      connection = await connect(environment.DBUS_SESSION_BUS_ADDRESS);
      let enabled = false;
      for (let attempt = 0; !enabled && attempt < 100; attempt++) {
        const [owned] = await call(connection, 'org.freedesktop.DBus', '/org/freedesktop/DBus',
          'org.freedesktop.DBus', 'NameHasOwner', new GLib.Variant('(s)', ['org.gnome.Shell']), '(b)');
        if (owned) {
          const [info] = await call(connection, 'org.gnome.Shell', '/org/gnome/Shell',
            'org.gnome.Shell.Extensions', 'GetExtensionInfo', new GLib.Variant('(s)', [UUID]), '(a{sv})');
          const value = field => info[field]?.deepUnpack?.() ?? info[field];
          enabled = value('state') === ExtensionState.ACTIVE && String(value('path')).startsWith(`${root}/data/`);
          if (attempt === 0) print(`[simulation] Devkit extension: state=${value('state')}; path=${value('path')}`);
        }
        if (!enabled) await pause(100);
      }
      assert(enabled, 'The actual rebuilt extension must be active in the inner Devkit Shell');
      const configuration = `${root}/config/glib-2.0/settings/keyfile`;
      await until(() => Gio.File.new_for_path(configuration).query_exists(null)
        && text(configuration).includes('device-id='), 'inner extension writes its own device identity');
      const keyfile = new GLib.KeyFile();
      keyfile.load_from_file(configuration, GLib.KeyFileFlags.NONE);
      const identity = keyfile.get_string('org/gnome/shell/extensions/clipboard-x-gnome', 'device-id').replaceAll("'", '');
      assert(/^[a-f0-9-]{36}$/.test(identity) && identity !== outerIdentity
        && desktop.settings.get_string('device-id') === outerIdentity,
      'The real inner extension must generate a separate identity without changing outer settings');
      const version = JSON.parse(text(`${project}/package.json`)).version;
      assert(Gio.File.new_for_path(`${build}/clipboard-x-gnome_${version}.zip`).query_exists(null),
        'The development script must actually package the fresh extension');
      await until(() => window.get_compositor_private()?.mapped && window.get_frame_rect().width > 0,
        'real PipeWire-backed Devkit window is mapped', 15000);
      const frame = window.get_frame_rect();
      await desktop.pointClick(frame.x + 25, frame.y + 25);
      Main.activateWindow(window);
      await until(() => global.display.focus_window === window, 'real Devkit window focused before normal close');
      await screenshot('OPS-07-devkit-ready');
      // An actual key event supplies a valid Wayland serial; automation's
      // get_current_time() can be zero outside an input handler.
      await desktop.key(Clutter.KEY_F4, [Clutter.KEY_Alt_L]);
      await until(() => exited && !global.get_window_actors().some(actor => actor.meta_window === window),
        'closing the actual Devkit window naturally exits the unmodified script', 15000);
      await pendingExit;
      assert(process.get_successful() && !Gio.File.new_for_path(`/proc/${shellPid}`).query_exists(null),
        'Normal GUI close must finish successfully and release its inner Shell process');
      await close(connection);
      connection = null;
      const output = text(terminal);
      const markers = ['[BUILD] Build and packaging completed', '[INFO] extension enable',
        '[INFO] extension initialize-clipboard completed'];
      // Closing systemd-cat completes the writer, not journald's asynchronous
      // indexing. Observe the actual records rather than assuming zero delay.
      let journal = '';
      const deadline = GLib.get_monotonic_time() + 5_000_000;
      do {
        journal = await command(['journalctl', '--user', '--no-pager', '-o', 'cat', '-t', 'clipboard-x-gnome-devkit']);
        if (markers.every(marker => journal.includes(marker)) && journal.includes('Shutting down GNOME Shell')) break;
        await pause(25);
      } while (GLib.get_monotonic_time() < deadline);
      Gio.File.new_for_path(`${artifacts}/devkit-user-journal.log`).replace_contents(new TextEncoder().encode(journal),
        null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
      for (const marker of markers) {
        assert(output.split(marker).length === 2 && journal.split(marker).length === 2,
          `The actual terminal and persistent user journal must each receive ${marker} exactly once`);
      }
      assert(journal.includes('Shutting down GNOME Shell'), 'The real inner Shell must report its normal shutdown');
      assert(!output.includes('Journal forwarding failed'), 'Successful Devkit acceptance must really use the journal');
      print('[simulation] Real Devkit: fresh build/ZIP; private XDG/bus/identity; zh_CN; native close exit=0; terminal+journal once');
    }, () => [
      {close: () => { if (window && global.get_window_actors().some(actor => actor.meta_window === window)) window.delete(global.get_current_time()); }},
      {close: () => { if (process && !exited) process.force_exit(); }}, // Failure cleanup only, not a passing exit.
      {close: () => close(connection)},
      {close: () => stop(wireplumber)},
      {close: () => stop(pipewire)},
    ]);
  },
};
