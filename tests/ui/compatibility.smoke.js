import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'clipboard-x@guleoo.github.io';
export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function indicator() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const extension = Main.extensionManager.lookup(UUID);
    const actor = Main.panel.statusArea['clipboard-x'];
    if (extension?.enabled && actor)
      return actor;
    await Scripting.sleep(50);
  }
  const extension = Main.extensionManager.lookup(UUID);
  throw new Error(`Extension did not enable: ${extension?.error ?? 'no indicator'}`);
}

export async function run() {
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  Main.overview.hide();
  let actor = await indicator();
  assert(actor._actions.extensionObject._terminalInput._device,
    'Shared backend/seat API did not create the virtual keyboard');
  assert(global.stage.context.get_backend().get_default_seat(),
    'Shared backend/seat API is unavailable');

  actor.menu.open();
  await Scripting.sleep(150);
  assert(actor.menu.isOpen, 'Main panel did not open');
  assert(actor._historyPanel.actor.orientation === Clutter.Orientation.VERTICAL,
    'Main panel must use the shared orientation property');
  assert(actor._historyPanel.scroll.get_vadjustment(),
    'Shared scroll adjustment API is unavailable');

  actor._panelManager.show('tokenizer', actor._tokenizer.createState(null, 'Hello, world!'));
  await Scripting.sleep(100);
  assert(actor._tokenizer._buttons.length > 0, 'Tokenizer panel did not render tokens');
  assert(actor._tokenizer.header.orientation === Clutter.Orientation.VERTICAL,
    'Shared panel header must use orientation');
  actor._openPhrases();
  await Scripting.sleep(100);
  assert(actor._quickPhrases.actor.orientation === Clutter.Orientation.VERTICAL,
    'Quick phrases panel must use orientation');
  actor.menu.close();

  Main.extensionManager.disableExtension(UUID);
  await Scripting.sleep(150);
  assert(!Main.panel.statusArea['clipboard-x'], 'Disabling did not destroy the indicator');
  Main.extensionManager.enableExtension(UUID);
  actor = await indicator();
  actor.menu.open();
  await Scripting.sleep(100);
  assert(actor.menu.isOpen, 'Panel did not open after re-enabling');
  actor.menu.close();
  Main.extensionManager.disableExtension(UUID);
  print('Clipboard X: shared Shell APIs and enable/disable/re-enable passed.');
}
