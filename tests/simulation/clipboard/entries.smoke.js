import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {assert} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function historyEntries(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const originalTypeItem = indicator._actions.typeItem;
  const originalPasteItem = indicator._actions.pasteItem;
  const multipleDevices = history._multipleDevices;
  try {
    indicator._settings.set_strv('panel-shortcut', ['<Super>v']);
    await Scripting.sleep(100);
    assert(extensionObject._shortcutBound, 'User shortcut was not registered');

    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'Clipboard X Gnome smoke test 你好 👋');
    await Scripting.sleep(500);
    assert(indicator._controller.items.some(item => item.text.includes('smoke test')),
      'Clipboard X Gnome did not capture a text clipboard change');
    const capturedText = indicator._controller.items.find(item => item.text.includes('smoke test'));
    indicator.menu.open();
    await Scripting.sleep(100);
    indicator.menu.close();
    await Scripting.sleep(100);
    history._multipleDevices = true;
    const localRow = history.entry(capturedText);
    const localContentBody = localRow.focusActors[0].get_child();
    assert(!localContentBody.get_children().some(child =>
      child.has_style_class_name?.('cbx-device-icon')),
    'Local clipboard history should not show a device icon');
    localRow.destroy();
    const deviceRow = history.entry(new capturedText.constructor({
      ...capturedText,
      originDeviceId: 'remote-device-id',
      originDeviceTag: 'Remote smoke test',
      originDeviceIconKind: 'computer',
    }));
    const deviceContentBody = deviceRow.focusActors[0].get_child();
    assert(deviceContentBody.get_children().some(child =>
      child.has_style_class_name?.('cbx-device-icon')),
    'Remote clipboard history did not show its device identity');
    deviceRow.destroy();
    history._multipleDevices = false;
    const originalEntryActions = indicator._settings.get_strv('entry-actions');
    const originalHiddenEntryActions = indicator._settings.get_strv('entry-hidden-actions');
    indicator._settings.set_strv('entry-actions', ['delete', 'pin', 'sync', 'tokenize', 'edit']);
    indicator._settings.set_strv('entry-hidden-actions', ['pin', 'sync']);
    const reorderedRow = history.entry(capturedText);
    assert(reorderedRow.focusActors.slice(1).map(actor => actor._clipboardXGnomeEntryAction).join()
        === 'delete,tokenize',
      'Entry action visibility and order were not reflected in keyboard focus order');
    assert(reorderedRow._clipboardXGnomeFocusRow.length === 3,
      'Hidden entry icons must not occupy focus matrix cells');
    reorderedRow.destroy();
    indicator._settings.set_strv('entry-hidden-actions', originalEntryActions);
    const contentOnlyRow = history.entry(capturedText);
    assert(contentOnlyRow.focusActors.length === 1,
      'Hiding all entry icons must retain only the copyable content');
    contentOnlyRow.destroy();
    indicator._settings.set_strv('entry-actions', originalEntryActions);
    indicator._settings.set_strv('entry-hidden-actions', originalHiddenEntryActions);
    assert(indicator._controller.search('SMOKE TEST').includes(capturedText),
      'Case-insensitive clipboard history search did not find the expected entry');
    const itemCommands = [];
    indicator._actions.typeItem = async item => itemCommands.push(`type:${item.id}`);
    indicator._actions.pasteItem = async item => itemCommands.push(`paste:${item.id}`);
    const entryEvent = (key, modifiers = 0) => ({
      get_key_symbol: () => key,
      get_state: () => modifiers,
    });
    assert(history.handleEntryKey(capturedText, entryEvent(Clutter.KEY_v)) === Clutter.EVENT_STOP,
      'Clipboard entry paste shortcut was not consumed');
    assert(history.handleEntryKey(capturedText, entryEvent(Clutter.KEY_apostrophe)) === Clutter.EVENT_STOP,
      'Clipboard entry typing shortcut was not consumed');
    assert(history.handleEntryKey(
      capturedText,
      entryEvent(Clutter.KEY_Return, Clutter.ModifierType.CONTROL_MASK),
    ) === Clutter.EVENT_PROPAGATE, 'Ctrl+Enter should not invoke clipboard entry typing');
    await Scripting.sleep(10);
    assert(itemCommands.join(',') === `paste:${capturedText.id},type:${capturedText.id}`,
      'Clipboard entry keyboard commands invoked the wrong actions');
    indicator._settings.set_strv('history-paste-shortcut', ['x']);
    assert(history.handleEntryKey(capturedText, entryEvent(Clutter.KEY_v)) === Clutter.EVENT_PROPAGATE,
      'Reconfigured clipboard entry shortcut kept its old binding');
    assert(history.handleEntryKey(capturedText, entryEvent(Clutter.KEY_x)) === Clutter.EVENT_STOP,
      'Reconfigured clipboard entry shortcut did not use its new binding');
    await Scripting.sleep(10);
    assert(itemCommands.at(-1) === `paste:${capturedText.id}`,
      'Reconfigured clipboard entry shortcut invoked the wrong action');
    indicator._settings.set_strv('history-paste-shortcut', ['v']);
    indicator._actions.typeItem = originalTypeItem;
    indicator._actions.pasteItem = originalPasteItem;
    indicator._settings.set_strv('entry-hidden-actions', ['pin']);
    history.handleEntryKey(capturedText, entryEvent(Clutter.KEY_p));
    assert(capturedText.favorite, 'Clipboard entry p shortcut did not pin the entry');
    history.handleEntryKey(capturedText, entryEvent(Clutter.KEY_p));
    assert(!capturedText.favorite, 'Clipboard entry p shortcut did not unpin the entry');
    indicator._settings.set_strv('entry-hidden-actions', originalHiddenEntryActions);
  } finally {
    indicator._actions.typeItem = originalTypeItem;
    indicator._actions.pasteItem = originalPasteItem;
    history._multipleDevices = multipleDevices;
    indicator.menu.close();
  }
}

export function run() {
  return runChecks([['historyEntries', historyEntries]]);
}
