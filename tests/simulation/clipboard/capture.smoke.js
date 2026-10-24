import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';
import {assert, capturedKeyEvent, waitUntil, waitForExit, fixturePath} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function clipboardSources(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const capturedText = indicator._controller.add(ClipboardItem.fromText('Clipboard source activation fixture'));
  try {
    const originalTimestamp = capturedText.createdAt;
    await indicator._controller.activate(capturedText);
    await Scripting.sleep(300);
    assert(capturedText.createdAt === originalTimestamp,
      'Programmatic clipboard activation was captured again instead of being loop-suppressed');

    indicator._settings.set_boolean('private-mode', true);
    assert(history.privateButton.checked, 'Privacy mode button did not reflect the enabled state');
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'private clipboard value must not be recorded');
    await Scripting.sleep(300);
    assert(!indicator._controller.items.some(item => item.text.includes('private clipboard value')),
      'Private mode did not pause clipboard capture');
    indicator._settings.set_boolean('private-mode', false);
    assert(!history.privateButton.checked, 'Privacy mode button did not reflect the disabled state');

    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'disposable clipboard history entry');
    await Scripting.sleep(300);
    const disposable = indicator._controller.items.find(item => item.text === 'disposable clipboard history entry');
    assert(disposable, 'Disposable history fixture was not captured');
    history.handleEntryKey(disposable, capturedKeyEvent(Clutter.KEY_Delete));
    assert(!indicator._controller.items.includes(disposable), 'Clipboard history entry could not be deleted');

    if (GLib.getenv('CLIPBOARD_X_GNOME_SKIP_EXTERNAL_SOURCES') !== '1') {
      // Without data-control, wl-copy needs its temporary window to receive focus.
      Main.overview.hide();
      assert(await waitUntil(() => !Main.overview.visible),
        'Overview did not close before launching the clipboard source');
      const waylandSource = Gio.Subprocess.new(
        ['/usr/bin/wl-copy', '--foreground', '--type', 'text/plain;charset=utf-8'],
        Gio.SubprocessFlags.STDIN_PIPE,
      );
      const waylandInput = waylandSource.get_stdin_pipe();
      waylandInput.write_all(
        new TextEncoder().encode('Clipboard X Gnome native Wayland source'),
        null,
      );
      waylandInput.close(null);
      const capturedWaylandSource = await waitUntil(
        () => indicator._controller.items.some(item => item.text === 'Clipboard X Gnome native Wayland source'),
      );
      const waylandMimeTypes = indicator._controller._selection
        .get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
      waylandSource.force_exit();
      await waitForExit(waylandSource);
      assert(capturedWaylandSource,
        `Clipboard X Gnome did not capture a native Wayland application source (${waylandMimeTypes.join(', ')})`);

      const xwaylandLauncher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
      xwaylandLauncher.setenv('GDK_BACKEND', 'x11', true);
      const xwaylandSource = xwaylandLauncher.spawnv([
        '/usr/bin/gjs',
        '-m',
        fixturePath('clipboard-source.js'),
        'Clipboard X Gnome XWayland source',
      ]);
      const capturedXwaylandSource = await waitUntil(
        () => indicator._controller.items.some(item => item.text === 'Clipboard X Gnome XWayland source'),
      );
      await waitForExit(xwaylandSource);
      assert(xwaylandSource.get_successful(),
        'XWayland clipboard source exited with an error');
      assert(capturedXwaylandSource,
        'Clipboard X Gnome did not capture an XWayland application source');
    }

    for (let index = 0; index < 50; index++)
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, `rapid clipboard change ${index}`);
    await Scripting.sleep(800);
    assert(indicator._controller.items.some(item => item.text === 'rapid clipboard change 49'),
      'Clipboard X Gnome lost the final value during rapid clipboard changes');
  } finally {
    indicator.menu.close();
    indicator._controller.remove(capturedText.id);
  }
}

export function run() {
  return runChecks([['clipboardSources', clipboardSources]]);
}
