import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

const UUID = 'clipboard-x@guleo.github.io';
const STATUS_AREA_NAME = 'clipboard-x';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

export async function run() {
  await Scripting.sleep(500);

  const extension = Main.extensionManager.lookup(UUID);
  assert(extension, 'Clipboard X extension was not installed');
  assert(extension.state === 1, `Clipboard X was not enabled (state ${extension.state})`);

  let indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X indicator was not added to the panel');
  if (GLib.getenv('CLIPBOARD_X_EXPECT_CHINESE') === '1') {
    assert(indicator._search.hint_text === '搜索剪切板历史…',
      `Clipboard X translation was not loaded (${indicator._search.hint_text})`);
  }

  indicator.menu.open();
  await Scripting.sleep(200);
  assert(indicator.menu.isOpen, 'Clipboard X menu did not open');
  assert(global.stage.get_key_focus() === indicator._search,
    'Opening the panel must focus its keyboard-search entry');

  indicator.menu.close();
  await Scripting.sleep(100);
  assert(!indicator.menu.isOpen, 'Clipboard X menu did not close');

  const deviceId = indicator._settings.get_string('device-id');
  assert(/^[0-9a-f-]{36}$/u.test(deviceId), 'Opening Clipboard X did not create a DeviceId');
  const extensionObject = extension.stateObj;
  assert(extensionObject, 'Clipboard X extension object is unavailable');

  indicator._settings.set_boolean('show-indicator', false);
  await Scripting.sleep(100);
  assert(!indicator.visible, 'Panel visibility setting did not apply immediately');
  indicator._settings.set_boolean('show-indicator', true);
  indicator._settings.set_strv('panel-shortcut', ['<Super>v']);
  await Scripting.sleep(100);
  assert(extensionObject._shortcutBound, 'User shortcut was not registered');

  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'Clipboard X smoke test 你好 👋');
  await Scripting.sleep(500);
  assert(indicator._controller.items.some(item => item.text.includes('smoke test')),
    'Clipboard X did not capture a text clipboard change');
  const capturedText = indicator._controller.items.find(item => item.text.includes('smoke test'));
  assert(indicator._controller.search('SMOKE TEST').includes(capturedText),
    'Case-insensitive clipboard history search did not find the expected entry');
  indicator._controller.toggleFavorite(capturedText.id);
  assert(capturedText.favorite, 'Clipboard history entry could not be favorited');
  indicator._controller.toggleFavorite(capturedText.id);
  assert(!capturedText.favorite, 'Clipboard history entry could not be unfavorited');
  const originalTimestamp = capturedText.createdAt;
  await indicator._controller.activate(capturedText);
  await Scripting.sleep(300);
  assert(capturedText.createdAt === originalTimestamp,
    'Programmatic clipboard activation was captured again instead of being loop-suppressed');

  indicator._settings.set_boolean('private-mode', true);
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'private clipboard value must not be recorded');
  await Scripting.sleep(300);
  assert(!indicator._controller.items.some(item => item.text.includes('private clipboard value')),
    'Private mode did not pause clipboard capture');
  indicator._settings.set_boolean('private-mode', false);

  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'disposable clipboard history entry');
  await Scripting.sleep(300);
  const disposable = indicator._controller.items.find(item => item.text === 'disposable clipboard history entry');
  assert(disposable, 'Disposable history fixture was not captured');
  indicator._controller.remove(disposable.id);
  assert(!indicator._controller.items.includes(disposable), 'Clipboard history entry could not be deleted');

  const waylandSource = Gio.Subprocess.new(
    ['/usr/bin/wl-copy', '--paste-once', '--type', 'text/plain;charset=utf-8'],
    Gio.SubprocessFlags.STDIN_PIPE,
  );
  const waylandInput = waylandSource.get_stdin_pipe();
  waylandInput.write_all(
    new TextEncoder().encode('Clipboard X native Wayland source'),
    null,
  );
  waylandInput.close(null);
  await Scripting.sleep(600);
  assert(indicator._controller.items.some(item => item.text === 'Clipboard X native Wayland source'),
    'Clipboard X did not capture a native Wayland application source');

  const xwaylandLauncher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
  xwaylandLauncher.setenv('GDK_BACKEND', 'x11', true);
  const xwaylandSource = xwaylandLauncher.spawnv([
    '/usr/bin/gjs',
    '-m',
    GLib.build_filenamev([GLib.get_current_dir(), 'tests', 'clipboard-source.js']),
    'Clipboard X XWayland source',
  ]);
  await Scripting.sleep(800);
  assert(!xwaylandSource.get_if_exited() || xwaylandSource.get_successful(),
    'XWayland clipboard source exited with an error');
  assert(indicator._controller.items.some(item => item.text === 'Clipboard X XWayland source'),
    'Clipboard X did not capture an XWayland application source');

  for (let index = 0; index < 50; index++)
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, `rapid clipboard change ${index}`);
  await Scripting.sleep(800);
  assert(indicator._controller.items.some(item => item.text === 'rapid clipboard change 49'),
    'Clipboard X lost the final value during rapid clipboard changes');

  const png = GLib.base64_decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  );
  St.Clipboard.get_default().set_content(
    St.ClipboardType.CLIPBOARD,
    'image/png',
    new GLib.Bytes(png),
  );
  await Scripting.sleep(800);
  const imageItem = indicator._controller.items.find(item => item.isImage && item.preview?.path);
  assert(imageItem,
    'Clipboard X did not asynchronously create an image thumbnail');
  indicator._settings.set_string('editor-app-id', '');
  indicator._settings.set_string('editor-command', '/usr/bin/true %f');
  await extensionObject._editItem(imageItem);
  assert(imageItem.primary.path, 'Immediate image editing did not persist a stable original path');
  imageItem.remote = true;
  imageItem.primary.bytes = null;
  await extensionObject._ensureMaterialized(imageItem);
  assert(imageItem.primary.bytes,
    'Previously downloaded remote content was not restored from local cache while offline');
  imageItem.remote = false;

  indicator._settings.set_boolean('sync-enabled', true);
  indicator._settings.set_string('sync-send-mode', 'manual');
  const imageRow = indicator._imageItem(imageItem);
  assert(imageRow.get_children().filter(child => child instanceof St.Button).length === 4,
  'Image history row is missing its manual synchronization action');
  imageRow.destroy();

  const publish = extensionObject._publish;
  let automaticPublishes = 0;
  extensionObject._publish = async () => automaticPublishes++;
  indicator._settings.set_string('sync-send-mode', 'automatic');
  indicator._settings.set_boolean('sync-favorites-only', true);
  imageItem.favorite = false;
  extensionObject._publishAutomatically(imageItem);
  await Scripting.sleep(10);
  assert(automaticPublishes === 0, 'Favorites-only policy automatically sent an unselected item');
  imageItem.favorite = true;
  extensionObject._publishAutomatically(imageItem);
  await Scripting.sleep(10);
  assert(automaticPublishes === 1, 'Favorites-only policy did not send a favorited item');
  imageItem.sensitive = true;
  extensionObject._publishAutomatically(imageItem);
  await Scripting.sleep(10);
  assert(automaticPublishes === 1, 'Automatic policy sent sensitive content without permission');
  imageItem.sensitive = false;
  imageItem.favorite = false;
  extensionObject._publish = publish;
  indicator._settings.set_boolean('sync-favorites-only', false);
  indicator._settings.set_string('sync-send-mode', 'manual');
  indicator._settings.set_boolean('sync-enabled', false);

  extensionObject._pickColor();
  await Scripting.sleep(500);
  assert(extensionObject._colorPicker, 'Color picker did not acquire a modal overlay');
  assert(extensionObject._colorPicker._rgb?.length === 3, 'Color picker did not sample the stage texture');
  const pickedColor = extensionObject._colorPicker;
  pickedColor._onPicked(pickedColor._rgb);
  pickedColor.close();
  await Scripting.sleep(300);
  assert(!extensionObject._colorPicker, 'Color picker did not release its modal overlay');
  assert(indicator._controller.items.some(item => item.text.startsWith('#')),
    'Picked color did not enter clipboard history');
  const colorItem = indicator._controller.items.find(item => item.text.startsWith('#'));
  indicator._controller.toggleFavorite(colorItem.id);
  indicator._controller.clear();
  assert(indicator._controller.items.length === 1 && indicator._controller.items[0] === colorItem,
    'Clearing history did not preserve only favorited entries');

  extensionObject._pickColor();
  await Scripting.sleep(300);
  assert(extensionObject._colorPicker, 'Color picker did not reopen for lifecycle testing');

  const oldController = extensionObject._controller;
  const oldSync = extensionObject._sync;
  Main.extensionManager.disableExtension(UUID);
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME], 'Indicator remained after disabling Clipboard X');
  assert(!extensionObject._colorPicker, 'Disabling Clipboard X did not close the active color picker');
  assert(oldController._destroyed && oldController._selectionSignal === 0
      && oldController._settingsSignals.length === 0,
  'Disabling Clipboard X did not release clipboard and settings subscriptions');
  assert(oldSync._destroyed && oldSync._nameWatchId === 0 && oldSync._connectIdleId === 0
      && oldSync._transferWaiters.size === 0,
  'Disabling Clipboard X did not release D-Bus watches, idle sources or transfer waiters');
  assert(!extensionObject._shortcutBound, 'Disabling Clipboard X did not remove its shortcut');

  Main.extensionManager.enableExtension(UUID);
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X did not recover after being enabled again');
  assert(indicator._settings.get_string('device-id') === deviceId,
    'DeviceId changed after the extension was disabled and enabled again');
  assert(indicator._controller.items.some(item => item.favorite && item.text === colorItem.text),
    'Favorited clipboard history did not survive extension restart');

  Main.sessionMode.pushMode('unlock-dialog');
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME],
    'Clipboard X remained active after the session entered its lock mode');
  Main.sessionMode.popMode('unlock-dialog');
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X did not recover after the session left its lock mode');
  assert(indicator._settings.get_string('device-id') === deviceId,
    'DeviceId changed across the lock/unlock lifecycle');
}
