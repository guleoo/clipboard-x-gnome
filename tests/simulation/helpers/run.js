import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import GLib from 'gi://GLib';
import {UUID, STATUS_AREA_NAME, assert, waitUntil, scenario} from './checks.js';

export async function runChecks(checks) {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;

  const extension = Main.extensionManager.lookup(UUID);
  assert(extension, 'Clipboard X Gnome extension was not installed');
  assert(extension.enabled, `Clipboard X Gnome was not enabled (${extension.error ?? 'unknown error'})`);

  await waitUntil(() => Boolean(Main.panel.statusArea[STATUS_AREA_NAME]), 3000);
  if (!Main.panel.statusArea[STATUS_AREA_NAME]) {
    Main.extensionManager.disableExtension(UUID);
    await Scripting.sleep(100);
    Main.extensionManager.enableExtension(UUID);
    await waitUntil(() => Boolean(Main.panel.statusArea[STATUS_AREA_NAME]), 3000);
  }
  const indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, `Clipboard X Gnome indicator was not added to the panel (${extension.error ?? 'no extension error'})`);
  const extensionObject = extension.stateObj;
  await extensionObject._startup;
  const history = indicator._historyPanel;
  for (const item of indicator._controller.items)
    indicator._controller.remove(item.id);
  await Scripting.sleep(200);
  const expectedSearchTranslation = GLib.getenv('CLIPBOARD_X_GNOME_EXPECT_SEARCH_TRANSLATION')
    ?? (GLib.getenv('CLIPBOARD_X_GNOME_EXPECT_CHINESE') === '1' ? '搜索剪切板历史…' : null);
  if (expectedSearchTranslation) {
    assert(history.searchEntry.hint_text === expectedSearchTranslation,
      `Clipboard X Gnome translation was not loaded (${history.searchEntry.hint_text})`);
    if (GLib.getenv('CLIPBOARD_X_GNOME_TRANSLATION_ONLY') === '1')
      return;
  }

  const requested = GLib.getenv('CBX_SIMULATION_CASES')?.split(',');
  if (requested)
    assert(requested.every(name => checks.some(([id]) => name === id)), 'Unknown simulation case');
  for (const [name, check] of checks) {
    if (requested && !requested.includes(name)) continue;
    await Scripting.waitTestWindows();
    await scenario(name, indicator._settings, () => check(indicator, extensionObject));
    await Scripting.waitLeisure();
    print(`Clipboard X Gnome [smoke] PASS ${name}`);
  }
}
