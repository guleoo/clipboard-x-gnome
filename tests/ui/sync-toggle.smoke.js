import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'clipboard-x-gnome@guleoo.github.io';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

export async function run() {
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  let extension;
  for (let attempt = 0; attempt < 60; attempt++) {
    extension = Main.extensionManager.lookup(UUID)?.stateObj;
    if (extension?._indicator)
      break;
    await Scripting.sleep(50);
  }
  assert(extension?._indicator, 'Clipboard X Gnome did not start');
  await extension._startup;
  const indicator = extension._indicator;
  const settings = indicator._settings;
  const history = indicator._historyPanel;
  const controller = extension._controller;
  const {ClipboardItem} = await import(`${extension.dir.get_uri()}/clipboard/item.js`);
  const items = controller._items;
  const enabled = settings.get_boolean('sync-enabled');
  const hidden = settings.get_strv('entry-hidden-actions');
  try {
    settings.set_boolean('sync-enabled', false);
    controller._items = [
      ClipboardItem.fromText('Retain this content while toggling synchronization'),
      ClipboardItem.fromText('Local-only sensitive entry', {sensitive: true}),
    ];
    Main.overview.hide();
    indicator.menu.open();
    indicator._panelManager.show('history');
    await Scripting.sleep(150);
    const item = controller._items[0];
    const row = history._itemRows.get(item.id);
    const content = row.focusActors[0];
    const sync = row.focusActors.find(actor => actor._clipboardXGnomeEntryAction === 'sync');
    const sensitiveRow = history._itemRows.get(controller._items[1].id);
    assert(sync && !sync.visible && !history.focusGrid.contains(sync),
      'Disabled synchronization actions must be hidden and excluded from navigation');
    content.grab_key_focus();
    for (let attempt = 0; attempt < 3; attempt++) {
      history.syncButton.emit('clicked', Clutter.BUTTON_PRIMARY);
      assert(settings.get_boolean('sync-enabled') && history.syncButton.selected && sync.visible,
        'The sync button must enable synchronization and reveal the row action');
      assert(!sensitiveRow.focusActors.some(actor => actor._clipboardXGnomeEntryAction === 'sync'),
        'Sensitive entries must not acquire a synchronization action');
      assert(history._itemRows.get(item.id) === row && row.focusActors[0] === content
          && global.stage.get_key_focus() === content && history.focusGrid.contains(sync),
        'Enabling synchronization must retain content actors and keyboard focus');
      sync.grab_key_focus();
      settings.set_boolean('sync-enabled', false);
      assert(!sync.visible && !history.syncButton.selected && !history.focusGrid.contains(sync)
          && global.stage.get_key_focus() === content && history._itemRows.get(item.id) === row,
        'Disabling synchronization must retain the row and move focus off its hidden action');
    }
    settings.set_strv('entry-hidden-actions', [...hidden, 'sync']);
    settings.set_boolean('sync-enabled', true);
    assert([...history._itemRows.values()].every(value =>
      !value.focusActors.some(actor => actor._clipboardXGnomeEntryAction === 'sync')),
    'Toggling synchronization must respect hidden entry actions');
  } finally {
    controller._items = items;
    settings.set_strv('entry-hidden-actions', hidden);
    settings.set_boolean('sync-enabled', enabled);
    indicator.menu.close();
  }
}
