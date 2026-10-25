import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, block, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {restart} from '../helpers/restart.js';

async function fixture(desktop, run) {
  const target = await Target.open(desktop);
  const processes = [];
  const app = desktop.app;
  const launch = app._launchEditor;
  app._launchEditor = async function (...args) {
    const process = await launch.apply(this, args);
    if (process) processes.push(process);
    return process;
  };
  const width = 1024;
  const height = 1024;
  const pixels = new Uint8Array(width * height * 3);
  let seed = 123456;
  // Two distinctive canvas colors plus noisy borders large enough to fill a pipe.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = x < width / 2 ? [35, 164, 205] : [233, 107, 53];
    for (let channel = 0; channel < 3; channel++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels[(y * width + x) * 3 + channel] = y < 128 || y >= height - 128 ? seed & 255 : color[channel];
    }
  }
  const image = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(pixels), GdkPixbuf.Colorspace.RGB, false, 8, width, height, width * 3);
  const bytes = image.save_to_bufferv('png', [], [])[1];
  try {
    await target.offerBytes({'image/png': bytes});
    await until(() => desktop.app._controller.items.some(item => item.isImage && item.preview?.path), 'real editor image captured');
    const item = desktop.app._controller.items.find(item => item.isImage);
    await desktop.app._controller.persist();
    await run({target, item, processes});
  } finally {
    app._launchEditor = launch;
    for (const process of processes) {
      process.force_exit();
      await new Promise(resolve => process.wait_async(null, (object, result) => { object.wait_finish(result); resolve(); }));
    }
    await target.close();
  }
}

async function edit(desktop, item) {
  await desktop.open();
  await desktop.click(desktop.history._itemRows.get(item.id).focusActors
    .find(actor => actor._clipboardXGnomeEntryAction === 'edit'));
  await until(() => !desktop.indicator.menu.isOpen, 'native Edit closes popup');
}

function heartbeat() {
  let last = GLib.get_monotonic_time();
  const result = {ticks: 0, gap: 0};
  const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
    const now = GLib.get_monotonic_time(); result.gap = Math.max(result.gap, (now - last) / 1000);
    last = now; result.ticks++; return GLib.SOURCE_CONTINUE;
  });
  result.finish = () => {
    GLib.Source.remove(source);
    print(`[simulation] Native editor heartbeat: maxGapMs=${result.gap.toFixed(1)}; ticks=${result.ticks}`);
  };
  return result;
}

async function canvasHasFixture(window) {
  const [content, scale] = await new Shell.Screenshot().screenshot_stage_to_content();
  const frame = window.get_frame_rect();
  const texture = content.get_texture();
  const x = Math.max(0, Math.round(frame.x * scale));
  const y = Math.max(0, Math.round(frame.y * scale));
  const width = Math.min(texture.get_width() - x, Math.round(frame.width * scale));
  const height = Math.min(texture.get_height() - y, Math.round(frame.height * scale));
  if (width <= 0 || height <= 0) return false;
  const stream = Gio.MemoryOutputStream.new_resizable();
  try {
    const pixbuf = await Shell.Screenshot.composite_to_stream(texture, x, y, width, height, scale, null, 0, 0, 1, stream);
    const pixels = pixbuf.get_pixels();
    const counts = [0, 0];
    const colors = [[35, 164, 205], [233, 107, 53]];
    for (let row = 0; row < pixbuf.height; row++) for (let column = 0; column < pixbuf.width; column++) {
      const offset = row * pixbuf.rowstride + column * pixbuf.n_channels;
      for (const [index, color] of colors.entries())
        if (color.every((channel, component) => Math.abs(pixels[offset + component] - channel) <= 2)) counts[index]++;
    }
    return counts.every(count => count > 500);
  } finally { stream.close(null); }
}

async function gradia(desktop, command) {
  return fixture(desktop, async ({item, processes}) => {
    desktop.settings.set_string('editor-command', command);
    const before = new Set(global.get_window_actors().map(actor => actor.meta_window));
    const timing = heartbeat();
    let window;
    try {
      await edit(desktop, item);
      await until(() => processes.length > 0, 'actual editor process spawned');
      await until(() => {
        window = global.get_window_actors().map(actor => actor.meta_window).find(window => !before.has(window)
          && /gradia/i.test(`${window.get_title()} ${window.get_wm_class()}`));
        return Boolean(window);
      }, 'actual Gradia window in isolated desktop', 20000);
      let visible = false;
      for (let attempt = 0; !visible && attempt < 50; attempt++) {
        visible = await canvasHasFixture(window);
        if (!visible) await pause(100);
      }
      assert(visible, 'Gradia must display the actual two-color fixture, not merely open an empty window');
      await pause(100);
    } finally {
      window?.delete(global.get_current_time());
      timing.finish();
    }
    assert(timing.ticks > 5 && timing.gap < 1000, 'Actual Gradia launch must not stall Shell for one second');
  });
}

export const cases = {
  'EDIT-07-lifetime': desktop => fixture(desktop, async ({item, processes}) => {
    const helper = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('fixtures').get_child('editor-receiver.py').get_path();
    const output = `${GLib.get_tmp_dir()}/persistent-editor.json`;
    desktop.settings.set_string('editor-command', ['python3', helper, output, 'stay']
      .map(value => GLib.shell_quote(value)).join(' ') + ' %f');
    await edit(desktop, item);
    await until(() => processes.length === 1 && Gio.File.new_for_path(output).query_exists(null),
      'external editor has consumed its image and remains running');
    const pid = processes[0].get_identifier();
    let alive;
    await restart(desktop, async () => {
      const [, state] = Gio.File.new_for_path(`/proc/${pid}/status`).load_contents(null);
      alive = !/^State:\s+[ZX]/m.test(new TextDecoder().decode(state));
    });
    assert(alive, 'Disabling the extension must not kill the already launched external editor');
  }),

  'EDIT-01': desktop => fixture(desktop, async ({item, processes}) => {
    desktop.settings.set_string('editor-command', '');
    let reads = 0;
    const notifications = () => Main.messageTray.getSources().flatMap(source => source.notifications)
      .filter(notification => notification.title === desktop.app.gettext('Image editing'));
    const before = notifications().length;
    const file = desktop.app._content.file;
    desktop.app._content.file = function (...args) { reads++; return file.apply(this, args); };
    try {
      await edit(desktop, item);
      await until(() => notifications().length > before, 'actual empty editor command configuration notice');
      assert(reads === 0 && processes.length === 0, 'Missing command must not fetch originals or spawn a process');
    } finally { desktop.app._content.file = file; }
  }),

  'EDIT-06': desktop => fixture(desktop, async ({item, processes}) => {
    const release = `${GLib.get_tmp_dir()}/cbx-editor-release-${GLib.uuid_string_random()}`;
    const helper = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
      .get_child('logic').get_child('screenshot').get_child('fixtures').get_child('editor-stdin.py').get_path();
    const command = ['python3', helper, item.primary.path, release].map(value => GLib.shell_quote(value)).join(' ') + ' %i';
    const timing = heartbeat();
    try {
      desktop.settings.set_string('editor-command', command);
      await edit(desktop, item);
      await until(() => processes.length === 1 && timing.ticks > 15, 'GUI heartbeat while editor deliberately does not read stdin');
      Gio.File.new_for_path(release).replace_contents(new TextEncoder().encode('released'), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
      await new Promise((resolve, reject) => processes[0].wait_check_async(null, (object, result) => {
        try { object.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
      }));
      for (const command of ['/usr/bin/sleep 0.5 %i', '/usr/bin/true %i']) {
        desktop.settings.set_string('editor-command', command);
        const count = processes.length;
        await edit(desktop, item);
        await until(() => processes.length > count, 'non-reading/early-exit editor launched');
      }
      await pause(100);
    } finally { timing.finish(); }
    assert(timing.ticks > 5 && timing.gap < 1000, 'Actual stdin editor launch must not stall Shell for one second');
  }),

  'EDIT-07-native': desktop => gradia(desktop, 'gradia %i'),

  async 'EDIT-07-flatpak'(desktop) {
    const application = 'be.alexandervanhee.gradia';
    const info = Gio.Subprocess.new(['flatpak', 'info', application], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    const installed = await new Promise(resolve => info.wait_async(null, (object, result) => {
      object.wait_finish(result); resolve(object.get_successful());
    }));
    if (!installed) block(`Flatpak application ${application} is not installed`);
    await gradia(desktop, `flatpak run ${application} %i`);
  },
};
