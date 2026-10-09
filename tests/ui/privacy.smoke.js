import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import GLib from 'gi://GLib';

const UUID = 'clipboard-x-gnome@guleoo.github.io';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;

  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.stateObj, 'Clipboard X Gnome extension is unavailable');
  const indicator = Main.panel.statusArea['clipboard-x-gnome'];
  assert(indicator, 'Clipboard X Gnome indicator is unavailable');

  const controller = indicator._controller;
  const settings = indicator._settings;
  const originalSelection = controller._selection;
  const originalReadSelectionContent = controller._readSelectionContent;
  const originalSensitiveMode = settings.get_string('sensitive-content-mode');
  const originalSyncEnabled = settings.get_boolean('sync-enabled');
  const text = `sensitive-capture-${GLib.uuid_string_random()}`;
  let markedItem = null;

  try {
    settings.set_boolean('sync-enabled', false);
    settings.set_string('sensitive-content-mode', 'memory');
    controller._selection = {get_mimetypes: () => ['text/plain;charset=utf-8']};
    controller._readSelectionContent = () => Promise.resolve(
      new GLib.Bytes(new TextEncoder().encode(text)));

    const ordinaryItem = await controller.capture();
    await controller.persist();
    assert(ordinaryItem?.primary.path, 'Ordinary clipboard content did not persist');

    controller._selection.get_mimetypes = () => [
      'application/x-keepass2', 'text/plain;charset=utf-8',
    ];
    markedItem = await controller.capture();
    assert(markedItem?.sensitive && markedItem.id !== ordinaryItem.id
        && !controller.items.includes(ordinaryItem),
    'Sensitive recopy did not replace the ordinary duplicate');
    await controller.persist();
    assert(!markedItem.primary.path
        && !GLib.file_test(ordinaryItem.primary.path, GLib.FileTest.EXISTS)
        && !(await controller._store.load()).some(item => item.primary.sha256 === markedItem.primary.sha256),
    'Sensitive content remained in persistent history');

    let refusal = null;
    try {
      await extension.stateObj._publish(markedItem);
    } catch (error) {
      refusal = error;
    }
    assert(refusal?.code === 'sensitive_content',
      'Manual synchronization did not reject sensitive content');

    settings.set_boolean('sync-enabled', true);
    const row = indicator._historyPanel.entry(markedItem);
    assert(!row.focusActors.some(actor => actor._clipboardXGnomeEntryAction === 'sync'),
      'Sensitive history row exposed a synchronization action');
    row.destroy();

    settings.set_string('sensitive-content-mode', 'discard');
    assert(await controller.capture() === null,
      'Discard policy recorded marked content');
  } finally {
    if (markedItem)
      controller.remove(markedItem.id);
    controller._selection = originalSelection;
    controller._readSelectionContent = originalReadSelectionContent;
    settings.set_string('sensitive-content-mode', originalSensitiveMode);
    settings.set_boolean('sync-enabled', originalSyncEnabled);
  }
}
