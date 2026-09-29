import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import St from 'gi://St';

const UUID = 'clipboard-x@guleoo.github.io';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function hasDeviceIcon(row) {
  const contentBody = row.focusActors[0].get_child();
  return contentBody.get_children().some(child =>
    child.has_style_class_name?.('cbx-device-icon'));
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;

  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.enabled, 'Clipboard X extension was not enabled');
  const indicator = Main.panel.statusArea['clipboard-x'];
  assert(indicator, 'Clipboard X indicator was not added to the panel');

  const marker = `Clipboard X device badges ${Date.now()}`;
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, marker);
  for (let attempt = 0; attempt < 40 && !indicator._controller.items.some(item => item.text === marker); attempt++)
    await Scripting.sleep(50);
  const item = indicator._controller.items.find(entry => entry.text === marker);
  assert(item, 'Local clipboard content was not captured');

  const history = indicator._historyPanel;
  history._multipleDevices = true;
  const localRow = history.entry(item);
  assert(!hasDeviceIcon(localRow), 'Local clipboard content showed a device icon');
  localRow.destroy();

  const remoteRow = history.entry(new item.constructor({
    ...item,
    originDeviceId: 'remote-device-id',
    originDeviceTag: 'Remote test device',
    originDeviceIconKind: 'computer',
  }));
  assert(hasDeviceIcon(remoteRow), 'Remote clipboard content did not show a device icon');
  remoteRow.destroy();
  indicator._controller.remove(item.id);
}
