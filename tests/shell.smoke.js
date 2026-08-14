import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
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

  const extensionObject = extension.stateObj;
  assert(extensionObject, 'Clipboard X extension object is unavailable');
  extensionObject._pickColor();
  await Scripting.sleep(500);
  assert(extensionObject._colorPicker, 'Color picker did not acquire a modal overlay');
  assert(extensionObject._colorPicker._rgb?.length === 3, 'Color picker did not sample the stage texture');
  extensionObject._colorPicker.close();
  await Scripting.sleep(100);
  assert(!extensionObject._colorPicker, 'Color picker did not release its modal overlay');

  Main.extensionManager.disableExtension(UUID);
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME], 'Indicator remained after disabling Clipboard X');

  Main.extensionManager.enableExtension(UUID);
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X did not recover after being enabled again');
}
