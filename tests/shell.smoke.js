import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
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

  indicator.menu.open();
  await Scripting.sleep(200);
  assert(indicator.menu.isOpen, 'Clipboard X menu did not open');

  indicator.menu.close();
  await Scripting.sleep(100);
  assert(!indicator.menu.isOpen, 'Clipboard X menu did not close');

  const deviceId = indicator._settings.get_string('device-id');
  assert(/^[0-9a-f-]{36}$/u.test(deviceId), 'Opening Clipboard X did not create a DeviceId');

  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'Clipboard X smoke test 你好 👋');
  await Scripting.sleep(500);
  assert(indicator._controller.items.some(item => item.text.includes('smoke test')),
    'Clipboard X did not capture a text clipboard change');

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
  assert(indicator._controller.items.some(item => item.isImage && item.preview?.path),
    'Clipboard X did not asynchronously create an image thumbnail');

  const extensionObject = extension.stateObj;
  assert(extensionObject, 'Clipboard X extension object is unavailable');
  extensionObject._pickColor();
  await Scripting.sleep(500);
  assert(extensionObject._colorPicker, 'Color picker did not acquire a modal overlay');
  assert(extensionObject._colorPicker._rgb?.length === 3, 'Color picker did not sample the stage texture');
  extensionObject._colorPicker.close();
  await Scripting.sleep(100);
  assert(!extensionObject._colorPicker, 'Color picker did not release its modal overlay');

  extensionObject._pickColor();
  await Scripting.sleep(300);
  assert(extensionObject._colorPicker, 'Color picker did not reopen for lifecycle testing');

  Main.extensionManager.disableExtension(UUID);
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME], 'Indicator remained after disabling Clipboard X');
  assert(!extensionObject._colorPicker, 'Disabling Clipboard X did not close the active color picker');

  Main.extensionManager.enableExtension(UUID);
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X did not recover after being enabled again');
}
