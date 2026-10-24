import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {UUID, until} from './desktop.js';

// Re-enable the actual extension, retaining this test's virtual devices/defaults.
export async function restart(desktop, whileDisabled = async () => {}) {
  await desktop.destroy();
  await whileDisabled();
  Main.extensionManager.enableExtension(UUID);
  await until(() => Boolean(Main.panel.statusArea['clipboard-x-gnome']), 'extension re-enabled', 15000);
  const app = Main.extensionManager.lookup(UUID).stateObj;
  await app._startup;
  const indicator = app._indicator;
  Object.assign(desktop, {
    app, indicator, history: indicator._historyPanel, words: indicator._tokenizer,
    phrases: indicator._quickPhrases, settings: indicator._settings, manager: indicator._panelManager,
  });
  await desktop.phrases.ready;
}
