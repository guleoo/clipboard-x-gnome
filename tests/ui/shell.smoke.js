import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

const UUID = 'clipboard-x-gnome@guleoo.github.io';
const STATUS_AREA_NAME = 'clipboard-x-gnome';
const TEST_DIRECTORY = Gio.File.new_for_uri(import.meta.url).get_parent().get_path();

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function isDescendant(actor, ancestor) {
  for (let current = actor; current; current = current.get_parent()) {
    if (current === ancestor)
      return true;
  }
  return false;
}

function capturedKeyEvent(key, modifiers = 0) {
  return {
    type: () => Clutter.EventType.KEY_PRESS,
    get_key_symbol: () => key,
    get_state: () => modifiers,
  };
}

async function waitUntil(predicate, timeoutMilliseconds = 2000) {
  const deadline = GLib.get_monotonic_time() + timeoutMilliseconds * 1000;
  while (!predicate() && GLib.get_monotonic_time() < deadline)
    await Scripting.sleep(50);
  return predicate();
}

function waitForExit(process) {
  return new Promise((resolve, reject) => {
    process.wait_async(null, (source, result) => {
      try {
        resolve(source.wait_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function scenario(name, settings, action) {
  print(`Clipboard X Gnome [smoke] ${name}`);
  const snapshot = new Map(settings.list_keys().map(key => [key, settings.get_value(key)]));
  try {
    await action();
  } catch (error) {
    throw new Error(`${name}: ${error.message}`, {cause: error});
  } finally {
    for (const [key, value] of snapshot) {
      if (!settings.get_value(key).equal(value))
        settings.set_value(key, value);
    }
  }
}

function imageBytes() {
  const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 200, 100);
  image.fill(0x336699ff);
  const [encoded, bytes] = image.save_to_bufferv('png', [], []);
  assert(encoded, 'Could not encode the rectangular clipboard image fixture');
  return bytes;
}

export async function run() {
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

  for (const [name, check] of [
    ['panels and quick phrases', panels],
    ['simulated input guard', typingGuard],
    ['history entries', historyEntries],
    ['stable panel focus and scroll restoration', focusRestoration],
    ['word-selection keyboard navigation', wordSelection],
    ['word-selection clipped native dragging', clippedWordSelection],
    ['clipboard sources and privacy', clipboardSources],
    ['image editing and synchronization', images],
    ['durable incoming snapshots', receiving],
    ['startup history pruning', startupHistory],
    ['screenshot pipeline', screenshots],
    ['color picking and extension lifecycle', colorsAndLifecycle],
  ]) {
    await scenario(name, indicator._settings, () => check(indicator, extensionObject));
  }
}

async function panels(indicator) {
  const history = indicator._historyPanel;
  await indicator._quickPhrases.ready;
  const originalPhrases = indicator._quickPhrases.phrases;
  try {
    indicator.menu.open();
    await Scripting.sleep(200);
    assert(indicator.menu.isOpen, 'Clipboard X Gnome menu did not open');
    assert(indicator.menu.actor.width === indicator._settings.get_int('panel-width'),
      'Configured panel width was not enforced on the popup actor');
    assert(Number.isFinite(history.captureView().scrollValue),
      'Clipboard history view state could not read the GNOME 50 scroll adjustment');
    assert([history.searchEntry, history.searchEntry.clutter_text].includes(global.stage.get_key_focus()),
      'Opening an empty history panel must fall back to its search entry');
    const originalToolbarActions = indicator._settings.get_strv('panel-toolbar-actions');
    const originalFooterActions = indicator._settings.get_strv('panel-footer-actions');
    indicator._settings.set_strv('panel-toolbar-actions', [
      'color-picker', 'quick-phrases', 'screenshot',
    ]);
    indicator._settings.set_strv('panel-footer-actions', [
      'sync', 'private-mode', 'clear-history', 'preferences',
    ]);
    const configuredFooter = history.footer.contentActors.filter(actor => actor !== history.footerSpacer);
    assert(history.toolbar.get_children()[0] === history.colorButton
        && configuredFooter[0] === history.syncButton
        && configuredFooter[1] === history.privateButton,
    'Configured panel action order was not applied');
    indicator._settings.set_strv('panel-toolbar-actions', originalToolbarActions);
    indicator._settings.set_strv('panel-footer-actions', originalFooterActions);
    const originalHiddenActions = indicator._settings.get_strv('panel-hidden-actions');
    indicator._settings.set_strv('panel-hidden-actions', ['screenshot', 'preferences']);
    assert(history.screenshotButton.get_parent() === null
        && history.preferencesButton.get_parent() === null
        && history.toolbar.get_children().length === 2,
    'Configured hidden panel icons remained visible');
    indicator._settings.set_strv('panel-hidden-actions', originalHiddenActions);
    const originalPanelWidth = indicator._settings.get_int('panel-width');
    const originalPanelHeight = indicator._settings.get_int('panel-height');
    const resizedPanelWidth = Math.min(800, originalPanelWidth + 40);
    const resizedPanelHeight = Math.min(800, originalPanelHeight + 40);
    indicator._settings.set_int('panel-width', resizedPanelWidth);
    indicator._settings.set_int('panel-height', resizedPanelHeight);
    await Scripting.sleep(300);
    const resizedHistoryMenuHeight = Math.round(indicator.menu.actor.height);
    assert(Math.round(history.actor.height) === resizedPanelHeight,
      'Configured panel height was not applied to the complete history panel');
    await indicator._quickPhrases.replace(['Local smoke-test phrase']);
    indicator._openPhrases();
    await Scripting.sleep(100);
    assert(indicator._panelManager.is('phrases')
        && indicator._panelManager.geometry.width === resizedPanelWidth
        && indicator._panelManager.geometry.height === resizedPanelHeight
        && Math.round(indicator.menu.actor.width) === resizedPanelWidth
        && Math.abs(Math.round(indicator.menu.actor.height) - resizedHistoryMenuHeight) <= 1
        && Math.round(indicator._quickPhrases.actor.height) === resizedPanelHeight
        && indicator._quickPhrases.buttons.length === 1,
    `Saved-phrase panel did not match history geometry (${Math.round(indicator.menu.actor.height)} vs ${resizedHistoryMenuHeight})`);
    assert(global.stage.get_key_focus() === indicator._quickPhrases.focusAnchor,
      'Quick phrases did not start on its focus anchor');
    assert(indicator._quickPhrases.focusAnchor.handle(capturedKeyEvent(Clutter.KEY_Right))
        === Clutter.EVENT_STOP
        && global.stage.get_key_focus() === indicator._quickPhrases.buttons[0],
    'The quick-phrase anchor did not consume Right and focus the first phrase');
    const quickPhrases = indicator._quickPhrases;
    quickPhrases.addButton.grab_key_focus();
    indicator._tooltip.show(quickPhrases.addButton, {immediate: true});
    assert(indicator._tooltip.actor.visible, 'The persistent add action lost its tooltip after panel switching');
    indicator._panelManager.refresh('phrases');
    indicator._tooltip.show(quickPhrases.addButton, {immediate: true});
    assert(indicator._tooltip.actor.visible, 'Refreshing a panel detached its persistent action tooltip');
    quickPhrases.buttons[0].grab_key_focus();
    const phraseCommands = [];
    const originalTypeText = indicator._actions.typeText;
    const originalPasteText = indicator._actions.pasteText;
    const phraseShortcutKeys = ['history-type-shortcut', 'history-paste-shortcut', 'history-delete-shortcut'];
    const originalPhraseShortcuts = phraseShortcutKeys.map(key => indicator._settings.get_strv(key));
    const focusPhrase = (actionIndex = 0) => {
      indicator.menu.open();
      indicator._openPhrases();
      quickPhrases.focusAnchor.cancel();
      quickPhrases.rows[0].focusActors[actionIndex].grab_key_focus();
    };
    indicator._actions.typeText = async text => phraseCommands.push(`type:${text}`);
    indicator._actions.pasteText = async text => phraseCommands.push(`paste:${text}`);
    try {
      indicator._settings.set_strv('history-type-shortcut', ['apostrophe']);
      indicator._settings.set_strv('history-paste-shortcut', ['v']);
      indicator._settings.set_strv('history-delete-shortcut', ['Delete']);
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_apostrophe)) === Clutter.EVENT_STOP
          && !indicator.menu.isOpen,
      'Quick-phrase typing shortcut must be consumed and close the menu');
      focusPhrase(1);
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_v)) === Clutter.EVENT_STOP
          && !indicator.menu.isOpen,
      'Quick-phrase paste shortcut must also work while its action icon is focused');
      assert(phraseCommands.join(',') === 'type:Local smoke-test phrase,paste:Local smoke-test phrase',
        'Quick-phrase shortcuts did not send the focused text to the correct actions');
      indicator._settings.set_strv('history-type-shortcut', ['<Control>t']);
      focusPhrase();
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_apostrophe)) === Clutter.EVENT_PROPAGATE,
        'Quick phrases kept the old simulated-input shortcut after reconfiguration');
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_t, Clutter.ModifierType.CONTROL_MASK))
          === Clutter.EVENT_STOP,
      'Quick phrases did not honor a configured shortcut with modifiers');
      indicator._settings.set_strv('history-type-shortcut', []);
      focusPhrase();
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_apostrophe)) === Clutter.EVENT_PROPAGATE,
        'A disabled quick-phrase typing shortcut must not run');
      indicator._settings.set_strv('history-type-shortcut', ['apostrophe']);
      quickPhrases.showForm();
      const beforeInput = phraseCommands.length;
      for (const key of [Clutter.KEY_v, Clutter.KEY_apostrophe, Clutter.KEY_Delete]) {
        assert(indicator._handleMenuKey(capturedKeyEvent(key)) === Clutter.EVENT_PROPAGATE,
          'Entry shortcuts must not intercept text editing in the quick-phrase form');
      }
      assert(phraseCommands.length === beforeInput && quickPhrases.phrases.length === 1,
        'Editing a quick phrase triggered a clipboard action or deletion');
      quickPhrases.hideForm();
      focusPhrase();
      assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Delete)) === Clutter.EVENT_STOP,
        'Quick-phrase deletion shortcut was not consumed');
      assert(await waitUntil(() => !quickPhrases.phrases.includes('Local smoke-test phrase')),
        'Quick-phrase deletion shortcut did not delete the focused phrase');
      await quickPhrases.replace(['Local smoke-test phrase']);
    } finally {
      indicator._actions.typeText = originalTypeText;
      indicator._actions.pasteText = originalPasteText;
      phraseShortcutKeys.forEach((key, index) => indicator._settings.set_strv(key, originalPhraseShortcuts[index]));
    }
    indicator._quickPhrases.showForm();
    indicator._quickPhrases.toggleForm();
    assert(!indicator._quickPhrases.form.visible,
      'Activating the add action again did not collapse the quick-phrase form');
    assert(global.stage.get_key_focus() === indicator._quickPhrases.addButton,
      'Closing the quick-phrase form did not return focus to its initiating action');
    indicator._quickPhrases.toggleForm();
    indicator._quickPhrases.entry.set_text('New smoke-test phrase');
    await indicator._quickPhrases.save();
    assert(indicator._quickPhrases.phrases[0] === 'New smoke-test phrase'
        && !indicator._quickPhrases.form.visible,
    'Saved-phrase panel did not add a custom phrase');
    await indicator._quickPhrases.remove('New smoke-test phrase');
    assert(!indicator._quickPhrases.phrases.includes('New smoke-test phrase'),
      'Saved-phrase panel did not delete a phrase');
    const addPhrase = quickPhrases._store.add;
    let releaseSave;
    const delayed = new Promise(resolve => { releaseSave = resolve; });
    quickPhrases._store.add = async text => {
      await delayed;
      return addPhrase.call(quickPhrases._store, text);
    };
    quickPhrases.showForm();
    quickPhrases.entry.set_text('Delayed smoke-test phrase');
    const saving = quickPhrases.save();
    try {
      indicator._closePhrases();
      history.searchEntry.clutter_text.grab_key_focus();
      const focus = global.stage.get_key_focus();
      releaseSave();
      await saving;
      assert(indicator._panelManager.is('history') && global.stage.get_key_focus() === focus,
        'Completing a saved-phrase write stole focus from another panel');
    } finally {
      releaseSave();
      await saving;
      quickPhrases._store.add = addPhrase;
    }
    indicator._openPhrases();
    await phraseDrafts(quickPhrases);
    await indicator._quickPhrases.replace([]);
    indicator._quickPhrases.focusStart();
    await Scripting.sleep(50);
    assert(indicator._quickPhrases.buttons.length === 0
        && global.stage.get_key_focus() === indicator._quickPhrases.focusAnchor
        && indicator._quickPhrases.focusAnchor.handle(capturedKeyEvent(Clutter.KEY_Left))
          === Clutter.EVENT_STOP
        && global.stage.get_key_focus() === indicator._quickPhrases.addButton,
    'An empty quick-phrase panel did not fall back to the add action');
    await indicator._quickPhrases.replace(originalPhrases);
    indicator._closePhrases();
    assert(indicator._panelManager.is('history'),
      'Saved-phrase panel did not return to clipboard history');
    history.privateButton.grab_key_focus();
    indicator._tooltip.show(history.privateButton, {immediate: true});
    assert(indicator._tooltip.actor.visible && indicator._tooltip.actor.get_parent() === Main.uiGroup,
      'Icon help must use a floating Shell tooltip');
    indicator._tooltip._handleCapturedEvent({type: () => Clutter.EventType.MOTION});
    assert(!indicator._tooltip.actor.visible,
      'Moving the mouse did not dismiss a keyboard-triggered tooltip');
    const originalSearchShortcut = indicator._settings.get_strv('history-search-shortcut');
    indicator._settings.set_strv('history-search-shortcut', ['<Control>f']);
    assert(indicator._handleMenuKey({
      get_key_symbol: () => Clutter.KEY_f,
      get_state: () => Clutter.ModifierType.CONTROL_MASK,
    }) === Clutter.EVENT_STOP, 'Clipboard search shortcut was not consumed');
    assert([history.searchEntry, history.searchEntry.clutter_text].includes(global.stage.get_key_focus()),
      'Clipboard search shortcut did not focus the search entry');
    indicator._settings.set_strv('history-search-shortcut', originalSearchShortcut);
    const originalPanelConfineFocus = indicator._settings.get_boolean('panel-confine-focus');
    indicator._settings.set_boolean('panel-confine-focus', true);
    history.privateButton.grab_key_focus();
    assert(indicator._handleMenuKey({
      get_key_symbol: () => Clutter.KEY_Down,
      get_state: () => 0,
    }) === Clutter.EVENT_STOP, 'Panel focus guard did not consume navigation');
    assert(isDescendant(global.stage.get_key_focus(), indicator.menu.actor),
      'Panel focus navigation escaped the clipboard panel');
    indicator._settings.set_boolean('panel-confine-focus', false);
    assert(indicator._handleMenuKey({
      get_key_symbol: () => Clutter.KEY_Down,
      get_state: () => 0,
    }) === Clutter.EVENT_PROPAGATE, 'Disabled panel focus guard still consumed navigation');
    indicator._settings.set_boolean('panel-confine-focus', originalPanelConfineFocus);

    indicator.menu.close();
    await Scripting.sleep(100);
    assert(!indicator.menu.isOpen, 'Clipboard X Gnome menu did not close');
  } finally {
    await indicator._quickPhrases.replace(originalPhrases);
    indicator._quickPhrases.hideForm();
    indicator._closePhrases();
    indicator.menu.close();
  }
}

async function typingGuard(_indicator, extensionObject) {
  const terminalInput = extensionObject._terminalInput;
  const modifierState = terminalInput._modifierState;
  const cancelledCallback = terminalInput._onCancelled;
  try {
    let simulatedModifiers = Clutter.ModifierType.CONTROL_MASK;
    terminalInput._modifierState = () => simulatedModifiers;
    let modifiersReleased = false;
    const releaseWait = terminalInput._waitForModifiersReleased().then(result => {
      modifiersReleased = result;
    });
    await Scripting.sleep(50);
    assert(!modifiersReleased, 'Terminal input did not wait for the triggering Ctrl key to be released');
    simulatedModifiers = 0;
    await releaseWait;
    assert(modifiersReleased, 'Terminal input did not begin after the triggering Ctrl key was released');
    terminalInput._modifierState = modifierState.bind(terminalInput);
    let cancelledNotifications = 0;
    terminalInput._onCancelled = () => cancelledNotifications++;
    const activeTyping = {cancelled: false};
    terminalInput._typing = activeTyping;
    terminalInput._monitoring = true;
    const keyboardEvent = type => ({
      type: () => type,
      get_key_code: () => 30,
    });
    terminalInput._emitting = true;
    terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_PRESS));
    assert(cancelledNotifications === 0 && !activeTyping.cancelled,
      'Synchronous virtual keyboard event was mistaken for manual input');
    terminalInput._emitting = false;
    terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_PRESS));
    terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_PRESS));
    await Scripting.sleep(10);
    assert(activeTyping.cancelled && cancelledNotifications === 1,
      'Manual keyboard input did not cancel typing with one notification');
  } finally {
    terminalInput._modifierState = modifierState;
    terminalInput._onCancelled = cancelledCallback;
    terminalInput._typing = null;
    terminalInput._monitoring = false;
    terminalInput._emitting = false;
  }
}

async function historyEntries(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const originalTypeItem = indicator._actions.typeItem;
  const originalPasteItem = indicator._actions.pasteItem;
  const multipleDevices = history._multipleDevices;
  try {
    const originalAnchor = indicator._settings.get_string('panel-anchor');
    const originalOffsetX = indicator._settings.get_int('panel-offset-x');
    const originalOffsetY = indicator._settings.get_int('panel-offset-y');
    indicator._settings.set_string('panel-anchor', 'bottom-right');
    indicator._settings.set_int('panel-offset-x', -12);
    indicator._settings.set_int('panel-offset-y', -18);
    indicator._settings.set_boolean('show-indicator', false);
    await Scripting.sleep(100);
    const anchorMonitor = Main.layoutManager.currentMonitor ?? Main.layoutManager.primaryMonitor;
    const anchorWorkArea = Main.layoutManager.getWorkAreaForMonitor(anchorMonitor.index);
    assert(!indicator.visible
        && indicator.menu.sourceActor === indicator._menuAnchor
        && Math.round(indicator._menuAnchor.x) === anchorWorkArea.x + anchorWorkArea.width - 12
        && Math.round(indicator._menuAnchor.y) === anchorWorkArea.y + anchorWorkArea.height - 18,
    'Hidden indicator did not use the configured bottom-right panel anchor and offsets');
    indicator.toggle();
    await Scripting.sleep(100);
    assert(indicator.menu.isOpen, 'Panel shortcut toggle did not open the hidden-indicator menu');
    indicator.toggle();
    await Scripting.sleep(100);
    assert(!indicator.menu.isOpen, 'Invoking the panel shortcut toggle twice did not close the menu');
    indicator._settings.set_boolean('show-indicator', true);
    indicator._settings.set_string('panel-anchor', originalAnchor);
    indicator._settings.set_int('panel-offset-x', originalOffsetX);
    indicator._settings.set_int('panel-offset-y', originalOffsetY);
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
    assert([history.searchEntry, history.searchEntry.clutter_text].includes(global.stage.get_key_focus()),
      'Opening clipboard history did not focus its search entry');
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
    indicator._controller.toggleFavorite(capturedText.id);
    assert(capturedText.favorite, 'Clipboard history entry could not be favorited');
    indicator._controller.toggleFavorite(capturedText.id);
    assert(!capturedText.favorite, 'Clipboard history entry could not be unfavorited');
  } finally {
    indicator._actions.typeItem = originalTypeItem;
    indicator._actions.pasteItem = originalPasteItem;
    history._multipleDevices = multipleDevices;
    indicator.menu.close();
  }
}

async function phraseDrafts(panel) {
  const originalAdd = panel._store.add;
  const operations = [];
  panel._store.add = async text => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const operation = {text, release, error: null};
    operations.push(operation);
    await gate;
    if (operation.error)
      throw operation.error;
    return originalAdd.call(panel._store, text);
  };
  const submit = () => {
    const promise = panel.save();
    const operation = operations.at(-1);
    operation.promise = promise;
    return operation;
  };
  try {
    for (const change of ['edit', 'edit-back', 'reopen']) {
      panel.showForm();
      const original = `Submitted phrase ${change}`;
      panel.entry.set_text(original);
      const saving = submit();
      if (change === 'reopen') {
        panel.hideForm();
        panel.showForm();
      }
      panel.entry.set_text(`Newer draft ${change}`);
      if (change === 'edit-back')
        panel.entry.set_text(original);
      const draft = panel.entry.get_text();
      saving.release();
      await saving.promise;
      assert(panel.phrases.includes(original) && panel.formVisible && panel.entry.get_text() === draft,
        `Completing an old save must persist its phrase without clearing a newer ${change} draft`);
    }
    for (const edit of [false, true]) {
      panel.showForm();
      panel.entry.set_text(`Overlapping phrase ${edit}`);
      const first = submit();
      if (edit)
        panel.entry.set_text('Latest overlapping draft');
      const draft = panel.entry.get_text();
      const latest = submit();
      first.release();
      await first.promise;
      assert(panel.formVisible && panel.entry.get_text() === draft,
        'An earlier overlapping save must not close the latest submitted form');
      latest.release();
      await latest.promise;
      assert(panel.phrases.includes(draft) && !panel.formVisible && panel.entry.get_text() === '',
        'The latest unchanged successful save must close and clear its own form');
    }
    panel.showForm();
    panel.entry.set_text('Draft retained after failed persistence');
    const failed = submit();
    failed.error = new Error('Injected phrase save failure');
    failed.release();
    let error;
    try { await failed.promise; } catch (caught) { error = caught; }
    assert(error === failed.error && panel.formVisible
        && panel.entry.get_text() === 'Draft retained after failed persistence',
      'A failed save must leave the submitted draft visible for retry');
  } finally {
    for (const operation of operations)
      operation.release();
    await Promise.allSettled(operations.map(operation => operation.promise));
    panel._store.add = originalAdd;
    panel.hideForm();
  }
}

async function focusRestoration(indicator, extensionObject) {
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const history = indicator._historyPanel;
  const tokenizer = indicator._tokenizer;
  const phrases = indicator._quickPhrases;
  await phrases.ready;
  const originalPhrases = phrases.phrases;
  const now = Date.now();
  const items = ['A', 'B', 'NEW'].map((text, index) => ClipboardItem.fromText(`Focus identity ${text}`, {
    createdAt: now + (index === 2 ? 3000 : 2000 - index * 1000),
  }));
  const focusedItem = () => global.stage.get_key_focus()?._clipboardXGnomeHistoryRow?._clipboardXGnomeHistoryItem;
  const focusItem = (item, action) => {
    const row = history._itemRows.get(item.id);
    const actor = row?.focusActors.find(value => (value._clipboardXGnomeEntryAction ?? null) === action);
    assert(actor, `Missing focus target ${item.id}/${action}`);
    actor.grab_key_focus();
  };
  const scrollValue = panel => panel.scroll.get_vadjustment().value;
  const setScroll = panel => {
    const adjustment = panel.scroll.get_vadjustment();
    adjustment.value = Math.min(50, adjustment.upper - adjustment.page_size);
    assert(adjustment.value > 0, 'Focus fixture must have scrollable content');
    return adjustment.value;
  };
  // Input sources run before the low-priority view-restoration idle.
  const beforeRestore = action => new Promise((resolve, reject) => {
    GLib.idle_add(GLib.PRIORITY_HIGH_IDLE, () => {
      try {
        action();
        resolve();
      } catch (error) {
        reject(error);
      }
      return GLib.SOURCE_REMOVE;
    });
  });
  try {
    indicator._panelManager.show('history');
    indicator.menu.open();
    await Scripting.sleep(100);
    history.searchEntry.set_text('Focus identity');
    indicator._controller.add(items[0]);
    indicator._controller.add(items[1]);
    await Scripting.sleep(100);
    focusItem(items[1], 'pin');
    indicator._controller.add(items[2]);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[1].id
        && global.stage.get_key_focus()._clipboardXGnomeEntryAction === 'pin',
      'An incoming item changed the focused history item or action');
    indicator._controller.update(items[2]);
    await beforeRestore(() => {
      history.searchEntry.clutter_text.grab_key_focus();
      history.searchEntry.set_text('Focus identity B');
    });
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === history.searchEntry.clutter_text,
      'A queued history restoration must not override subsequent search input');
    history.searchEntry.set_text('Focus identity');
    await Scripting.sleep(100);
    focusItem(items[1], 'pin');
    indicator._controller.update(items[2]);
    await beforeRestore(() => history.privateButton.grab_key_focus());
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === history.privateButton,
      'A queued history restoration must not override a newly focused persistent action');
    focusItem(items[1], 'pin');
    indicator._controller.update(items[2]);
    indicator.menu.actor.grab_key_focus();
    indicator._controller.update(items[2]);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[1].id,
      'Consecutive history refreshes must preserve item focus despite non-control menu focus');
    indicator._controller.toggleFavorite(items[1].id);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[1].id
        && global.stage.get_key_focus()._clipboardXGnomeEntryAction === 'pin',
      'Pin reordering changed the focused history item or action');
    const pinned = global.stage.get_key_focus();
    indicator._settings.set_string('theme-color', '#123456');
    assert(global.stage.get_key_focus() === pinned && pinned.get_style().includes('#123456'),
      'Theme changes must update an existing pinned action without rebuilding it');
    indicator._controller.remove(items[1].id);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[2].id
        && global.stage.get_key_focus()._clipboardXGnomeEntryAction === 'pin',
      'Removing the focused item must fall back to its nearest remaining item and action');
    focusItem(items[0], null);
    indicator._controller.remove(items[0].id);
    await Scripting.sleep(100);
    assert(focusedItem()?.id === items[2].id,
      'Removing the last row must fall back to the previous item, not the footer');
    history.privateButton.grab_key_focus();
    indicator._controller.update(items[2]);
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === history.privateButton,
      'A history refresh must preserve a persistent toolbar or footer control');

    indicator._settings.set_int('panel-height', 200);
    const source = Array.from({length: 150}, (_, index) => `word${index}`).join(' ');
    const state = await tokenizer.createState(null, source);
    indicator._panelManager.show('tokenizer', state);
    tokenizer.focusStart();
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === tokenizer.focusAnchor,
      'Entering word selection must still start on its focus anchor');
    const token = tokenizer.buttons[15];
    token.grab_key_focus();
    tokenizer.setSelected(token, true);
    const tokenIndex = token._clipboardXGnomeToken.index;
    await Scripting.sleep(100);
    const tokenScroll = setScroll(tokenizer);
    indicator._settings.set_string('theme-color', '#654321');
    assert(global.stage.get_key_focus() === token && token.get_style().includes('#654321'),
      'Word-selection theme changes must update styles without rebuilding focused controls');
    const width = indicator._settings.get_int('panel-width');
    indicator._settings.set_int('panel-width', width === 420 ? 430 : 420);
    indicator._settings.set_int('panel-height', 210);
    await Scripting.sleep(150);
    assert(global.stage.get_key_focus()?._clipboardXGnomeToken?.index === tokenIndex
        && tokenizer.focusGrid.contains(global.stage.get_key_focus())
        && Math.abs(scrollValue(tokenizer) - tokenScroll) < 1,
      'Word-selection resize must preserve token identity and scroll, including consecutive refreshes');
    indicator._panelManager.refresh('tokenizer');
    tokenizer.focusAnchor.grab_key_focus();
    indicator._panelManager.refresh('tokenizer');
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus()?._clipboardXGnomeToken?.index === tokenIndex,
      'Consecutive token refreshes must not mistake default anchor focus for new business input');
    indicator._panelManager.refresh('tokenizer');
    let navigatedIndex;
    await beforeRestore(() => {
      tokenizer.buttons[1].grab_key_focus();
      indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Right));
      navigatedIndex = global.stage.get_key_focus()?._clipboardXGnomeToken?.index;
      assert(navigatedIndex === state.tokens[2].index, 'The queued keyboard input must navigate to a new token');
    });
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus()?._clipboardXGnomeToken?.index === navigatedIndex,
      'A queued token restoration must not undo subsequent keyboard navigation');
    indicator._panelManager.refresh('tokenizer');
    await beforeRestore(() => {
      tokenizer.buttons[3].grab_key_focus();
      indicator._panelManager.refresh('tokenizer');
    });
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus()?._clipboardXGnomeToken?.index === state.tokens[3].index,
      'A second token refresh must capture the new focus instead of reusing an older pending snapshot');

    indicator._settings.set_int('saved-phrase-limit', 100);
    await phrases.replace(Array.from({length: 40}, (_, index) => `Focus phrase ${index}`));
    indicator._openPhrases();
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === phrases.focusAnchor,
      'Entering quick phrases must still start on its focus anchor');
    phrases.rows[5].focusActors[1].grab_key_focus();
    const phrase = phrases.rows[5]._clipboardXGnomePhrase;
    await Scripting.sleep(100);
    const phraseScroll = setScroll(phrases);
    const phraseActor = global.stage.get_key_focus();
    indicator._settings.set_string('theme-color', 'green');
    assert(global.stage.get_key_focus() === phraseActor,
      'Quick-phrase theme changes must not rebuild focused controls');
    indicator._settings.set_int('panel-width', 440);
    indicator._settings.set_int('panel-height', 220);
    await Scripting.sleep(150);
    const row = global.stage.get_key_focus()?._clipboardXGnomePhraseRow;
    assert(row?._clipboardXGnomePhrase === phrase
        && row.focusActors[1] === global.stage.get_key_focus()
        && Math.abs(scrollValue(phrases) - phraseScroll) < 1,
      `Quick-phrase resize must preserve phrase identity, action, and scroll (phrase=${row?._clipboardXGnomePhrase}/${phrase}, action=${row?.focusActors.indexOf(global.stage.get_key_focus())}, scroll=${scrollValue(phrases)}/${phraseScroll})`);
    await phrases.replace(['Inserted focus phrase', ...phrases.phrases]);
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus()?._clipboardXGnomePhraseRow?._clipboardXGnomePhrase === phrase,
      'Updating phrases must retain focus by phrase rather than row position');
    indicator._panelManager.refresh('phrases');
    await beforeRestore(() => phrases.rows[1].focusActors[1].grab_key_focus());
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === phrases.rows[1].focusActors[1],
      'A queued phrase restoration must not override a newly focused phrase action');
    indicator._panelManager.refresh('phrases');
    await beforeRestore(() => {
      phrases.rows[2].focusActors[1].grab_key_focus();
      indicator._panelManager.refresh('phrases');
    });
    await Scripting.sleep(100);
    assert(global.stage.get_key_focus() === phrases.rows[2].focusActors[1],
      'A second phrase refresh must retain the new phrase and action instead of the older snapshot');
  } finally {
    indicator._panelManager.show('history');
    indicator.menu.close();
    history.resetSearch();
    for (const item of items)
      indicator._controller.remove(item.id);
    await phrases.replace(originalPhrases);
  }
}

async function wordSelection(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const capturedText = indicator._controller.add(ClipboardItem.fromText('Word selection smoke test 你好'));
  const originalPanelWidth = indicator._settings.get_int('panel-width');
  const originalPanelHeight = indicator._settings.get_int('panel-height');
  const resizedPanelWidth = Math.min(800, originalPanelWidth + 40);
  const resizedPanelHeight = Math.min(800, originalPanelHeight + 40);
  indicator._settings.set_int('panel-width', resizedPanelWidth);
  indicator._settings.set_int('panel-height', resizedPanelHeight);
  indicator.menu.open();
  await Scripting.sleep(100);
  assert(await waitUntil(() => Math.round(history.actor.height) === resizedPanelHeight),
    'Resized history panel did not settle before word selection');
  const resizedHistoryMenuHeight = Math.round(indicator.menu.actor.height);
  try {
    const originalSourcePreview = indicator._settings.get_boolean('tokenizer-show-source-preview');
    const originalConfineFocus = indicator._settings.get_boolean('panel-confine-focus');
    indicator._settings.set_boolean('tokenizer-show-source-preview', false);
    indicator._settings.set_boolean('panel-confine-focus', true);
    indicator.menu.open();
    await Scripting.sleep(100);
    await indicator._openTokenizer(capturedText);
    await Scripting.sleep(100);
    const tokenState = indicator._panelManager.state;
    assert(indicator._panelManager.is('tokenizer') && tokenState?.tokens.length > 1
        && indicator._panelManager.geometry.width === resizedPanelWidth
        && indicator._panelManager.geometry.height === resizedPanelHeight
        && Math.round(indicator.menu.actor.width) === resizedPanelWidth
        && Math.abs(Math.round(indicator.menu.actor.height) - resizedHistoryMenuHeight) <= 1
        && Math.round(indicator._tokenizer.actor.height) === resizedPanelHeight
        && !history.item.visible
        && indicator._tokenizer.item.visible,
      `Text segmentation did not match history geometry (`
        + `${Math.round(indicator.menu.actor.height)} vs ${resizedHistoryMenuHeight})`);
    await Scripting.sleep(100);
    const tokenButtons = indicator._tokenizer.tokenBox.get_children()
      .flatMap(row => row.get_children());
    const unrelated = ClipboardItem.fromText('Background history update during word selection');
    indicator._controller.add(unrelated);
    assert(indicator._tokenizer.tokenBox.get_children().flatMap(row => row.get_children())[0] === tokenButtons[0],
      'An unrelated history change rebuilt the active word-selection controls');
    indicator._controller.remove(unrelated.id);
    assert(tokenButtons.length === tokenState.tokens.length,
      'Text segmentation did not render one visible button for each token');
    assert(tokenButtons.every(button => button.mapped && button.width > 0 && button.height > 0),
      'Text segmentation rendered word selection buttons outside the visible layout');
    assert(global.stage.get_key_focus() === indicator._tokenizer.focusAnchor,
      'Opening the tokenizer did not focus its anchor');
    assert(indicator._tokenizer.focusAnchor.handle(capturedKeyEvent(Clutter.KEY_Right))
        === Clutter.EVENT_STOP
        && global.stage.get_key_focus() === tokenButtons[0],
    'The tokenizer anchor did not consume Right and focus the first token');
    assert(!indicator._tokenizer.sourceLabel.visible,
      'Disabled source preview remained visible in the tokenizer');
    assert(indicator._tokenizer.handleKey(
      tokenButtons[0], capturedKeyEvent(Clutter.KEY_Right),
    ) === Clutter.EVENT_PROPAGATE
        && indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Right)) === Clutter.EVENT_STOP
        && global.stage.get_key_focus() === tokenButtons[1],
    'Right Arrow did not move focus to the next token');
    const lastTokenButton = tokenButtons.at(-1);
    lastTokenButton.grab_key_focus();
    assert(indicator._tokenizer.handleKey(
      lastTokenButton, capturedKeyEvent(Clutter.KEY_Right),
    ) === Clutter.EVENT_PROPAGATE,
    'Tokenizer edge navigation did not continue into the surrounding panel');
    assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Right)) === Clutter.EVENT_STOP
        && isDescendant(global.stage.get_key_focus(), indicator.menu.actor),
    'Confined tokenizer focus escaped at the final token');
    indicator._settings.set_boolean('panel-confine-focus', false);
    assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Right)) === Clutter.EVENT_PROPAGATE,
    'Disabled focus confinement still consumed an edge arrow key');
    indicator._settings.set_boolean('panel-confine-focus', true);
    indicator._settings.set_boolean('tokenizer-show-source-preview', true);
    assert(indicator._tokenizer.sourceLabel.visible,
      'Enabled source preview was not shown immediately');
    tokenButtons[0].grab_key_focus();
    indicator._tokenizer.handleKey(
      tokenButtons[0], capturedKeyEvent(Clutter.KEY_Right, Clutter.ModifierType.SHIFT_MASK),
    );
    assert(tokenState.selected.has(tokenState.tokens[0].index)
        && tokenState.selected.has(tokenState.tokens[1].index)
        && global.stage.get_key_focus() === tokenButtons[1],
      'Shift+Arrow did not extend word selection and keyboard focus');
    tokenButtons[0].grab_key_focus();
    assert(indicator._tokenizer.handleKey(
      tokenButtons[0], capturedKeyEvent(Clutter.KEY_Up),
    ) === Clutter.EVENT_PROPAGATE
        && indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Up)) === Clutter.EVENT_STOP
        && global.stage.get_key_focus() === indicator._tokenizer.backButton,
    'Up Arrow did not move from the first token to the tokenizer back button');
    lastTokenButton.grab_key_focus();
    assert(indicator._tokenizer.handleKey(
      lastTokenButton, capturedKeyEvent(Clutter.KEY_Down),
    ) === Clutter.EVENT_PROPAGATE
        && indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Down)) === Clutter.EVENT_STOP
        && global.stage.get_key_focus() === indicator._tokenizer.copyButton,
    'Down Arrow did not move from the final token to the copy button');
    assert(indicator._handleMenuKey(capturedKeyEvent(Clutter.KEY_Down)) === Clutter.EVENT_STOP
        && global.stage.get_key_focus() === indicator._tokenizer.copyButton,
    'Tokenizer copy button did not stop at the focus matrix boundary');
    tokenState.keyboardSelection = null;
    tokenButtons[0].grab_key_focus();
    indicator._tokenizer.handleKey(
      tokenButtons[0], capturedKeyEvent(Clutter.KEY_Right, Clutter.ModifierType.SHIFT_MASK),
    );
    assert(!tokenState.selected.has(tokenState.tokens[0].index)
        && !tokenState.selected.has(tokenState.tokens[1].index),
    'Shift+Arrow did not deselect a range anchored on a selected token');
    for (const button of tokenButtons)
      indicator._tokenizer.setSelected(button, false, false);
    tokenState.keyboardSelection = null;
    indicator._tokenizer.updateResult();
    indicator._tokenizer.setSelected(tokenButtons[0], true);
    indicator._tokenizer.setSelected(tokenButtons[1], false);
    assert(indicator._tokenizer.resultLabel.text === tokenState.tokens[0].text,
      'Selected token did not update the copy result preview');
    indicator._settings.set_boolean('tokenizer-show-source-preview', originalSourcePreview);
    indicator._settings.set_boolean('panel-confine-focus', originalConfineFocus);
    indicator._settings.set_int('panel-width', originalPanelWidth);
    indicator._settings.set_int('panel-height', originalPanelHeight);
    indicator._closeTokenizer();
    assert(indicator._panelManager.is('history')
        && history.item.visible
        && !indicator._tokenizer.item.visible,
      'Returning from text segmentation did not restore clipboard history');
    indicator.menu.close();
  } finally {
    indicator._closeTokenizer();
    indicator.menu.close();
    indicator._controller.remove(capturedText.id);
  }
}

export async function clippedWordSelection(indicator) {
  const panel = indicator._tokenizer;
  const pointer = global.stage.context.get_backend().get_default_seat()
    .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
  let held = false;
  const center = actor => {
    const [x, y] = actor.get_transformed_position();
    const [width, height] = actor.get_transformed_size();
    return [x + width / 2, y + height / 2];
  };
  const move = async point => {
    pointer.notify_absolute_motion(GLib.get_monotonic_time(), ...point);
    await Scripting.sleep(80);
  };
  const press = async button => {
    await move(center(button));
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    held = true;
    assert(await waitUntil(() => Boolean(panel._selectionDrag)), 'A native word press did not start selection');
  };
  const release = async () => {
    pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    held = false;
    assert(await waitUntil(() => !panel._selectionDrag) && panel._dragSourceId === 0,
      'Releasing a word drag must clear its selection timer');
  };
  try {
    indicator.menu.close();
    indicator._panelManager.show('history');
    assert(await waitUntil(() => !indicator.menu.actor.visible),
      'The previous menu must finish closing before the native drag scenario');
    Main.overview.hide();
    assert(await waitUntil(() => !Main.overview.visible && !Main.overview.animationInProgress),
      'Overview must close before native word dragging');
    for (let attempt = 0; attempt < 2; attempt++)
      await move([640, 360]);
    indicator._settings.set_int('panel-width', 360);
    indicator._settings.set_int('panel-height', 240);
    indicator._settings.set_boolean('tokenizer-show-source-preview', false);
    const state = await panel.createState(null,
      Array.from({length: 100}, (_, index) => `Word${index}`).join(' '));
    indicator.menu.open();
    indicator._panelManager.show('tokenizer', state);
    panel.focusStart();
    const geometry = () => `open=${indicator.menu.isOpen}, itemVisible=${panel.item.visible}, mapped=${panel.actor.mapped}, panelH=${panel.actor.height}, scrollH=${panel.scroll.height}`;
    assert(await waitUntil(() => indicator.menu.isOpen && panel.item.visible && panel.actor.mapped
        && Math.abs(panel.actor.height - 240) < 1 && panel.scroll.mapped
        && panel.scroll.height > 0 && panel.scroll.height < panel.actor.height),
      `The native drag menu must be open and have an allocated viewport (${geometry()})`);
    for (const edge of ['below', 'above']) {
      panel.scroll.get_vadjustment().remove_transition('value');
      panel.scroll.get_vadjustment().value = edge === 'below' ? 0 : 200;
      for (const button of panel.buttons)
        panel.setSelected(button, false, false);
      panel.updateResult();
      await Scripting.sleep(100);
      const [, top] = panel.scroll.get_transformed_position();
      const [, height] = panel.scroll.get_transformed_size();
      const visible = panel.buttons.filter(button => {
        const [, y] = center(button);
        return y > top + 5 && y < top + height - 5;
      }).sort((left, right) => Math.abs(center(left)[1] - top - height / 2)
        - Math.abs(center(right)[1] - top - height / 2));
      const clipped = panel.buttons.find(button => {
        const [, y] = center(button);
        return button.mapped && (edge === 'below'
          ? y > top + height + 20 && y < global.stage.height - 20
          : y < top - 5 && y > 5);
      });
      assert(visible.length > 1 && clipped,
        `The drag fixture needs visible words and mapped clipped words (edge=${edge}, top=${top}, height=${height}, visible=${visible.length}, clipped=${Boolean(clipped)}, tokens=${panel.buttons.length}, ${geometry()})`);
      await press(visible[0]);
      const selected = [...state.selected].sort().join();
      await move(center(clipped));
      assert([...state.selected].sort().join() === selected,
        `Dragging ${edge} the viewport must not select clipped words`);
      await move(center(visible[1]));
      assert(state.selected.has(visible[1]._clipboardXGnomeToken.index),
        'Returning inside the viewport must continue the original held selection');
      const returned = [...state.selected].sort().join();
      await move(center(clipped));
      await release();
      assert([...state.selected].sort().join() === returned,
        'Releasing outside the viewport must retain the last visible selection');
    }
    await press(panel.buttons.find(button => {
      const [, y] = center(button);
      const [, top] = panel.scroll.get_transformed_position();
      return y > top + 5 && y < top + panel.scroll.height - 5;
    }));
    indicator._panelManager.show('history');
    assert(!panel._selectionDrag && panel._dragSourceId === 0,
      'Leaving word selection during a native drag must stop its timer');
    await release();
  } finally {
    if (held)
      pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    panel.endSelectionDrag();
    indicator.menu.close();
    indicator._panelManager.reset();
  }
}

async function clipboardSources(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const capturedText = indicator._controller.add(ClipboardItem.fromText('Clipboard source activation fixture'));
  try {
    const originalTimestamp = capturedText.createdAt;
    await indicator._controller.activate(capturedText);
    await Scripting.sleep(300);
    assert(capturedText.createdAt === originalTimestamp,
      'Programmatic clipboard activation was captured again instead of being loop-suppressed');

    indicator._settings.set_boolean('private-mode', true);
    assert(history.privateButton.checked, 'Privacy mode button did not reflect the enabled state');
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'private clipboard value must not be recorded');
    await Scripting.sleep(300);
    assert(!indicator._controller.items.some(item => item.text.includes('private clipboard value')),
      'Private mode did not pause clipboard capture');
    indicator._settings.set_boolean('private-mode', false);
    assert(!history.privateButton.checked, 'Privacy mode button did not reflect the disabled state');

    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'disposable clipboard history entry');
    await Scripting.sleep(300);
    const disposable = indicator._controller.items.find(item => item.text === 'disposable clipboard history entry');
    assert(disposable, 'Disposable history fixture was not captured');
    history.handleEntryKey(disposable, capturedKeyEvent(Clutter.KEY_Delete));
    assert(!indicator._controller.items.includes(disposable), 'Clipboard history entry could not be deleted');

    if (GLib.getenv('CLIPBOARD_X_GNOME_SKIP_EXTERNAL_SOURCES') !== '1') {
      // Without data-control, wl-copy needs its temporary window to receive focus.
      Main.overview.hide();
      assert(await waitUntil(() => !Main.overview.visible),
        'Overview did not close before launching the clipboard source');
      const waylandSource = Gio.Subprocess.new(
        ['/usr/bin/wl-copy', '--foreground', '--type', 'text/plain;charset=utf-8'],
        Gio.SubprocessFlags.STDIN_PIPE,
      );
      const waylandInput = waylandSource.get_stdin_pipe();
      waylandInput.write_all(
        new TextEncoder().encode('Clipboard X Gnome native Wayland source'),
        null,
      );
      waylandInput.close(null);
      const capturedWaylandSource = await waitUntil(
        () => indicator._controller.items.some(item => item.text === 'Clipboard X Gnome native Wayland source'),
      );
      const waylandMimeTypes = indicator._controller._selection
        .get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
      waylandSource.force_exit();
      await waitForExit(waylandSource);
      assert(capturedWaylandSource,
        `Clipboard X Gnome did not capture a native Wayland application source (${waylandMimeTypes.join(', ')})`);

      const xwaylandLauncher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
      xwaylandLauncher.setenv('GDK_BACKEND', 'x11', true);
      const xwaylandSource = xwaylandLauncher.spawnv([
        '/usr/bin/gjs',
        '-m',
        GLib.build_filenamev([TEST_DIRECTORY, '..', 'fixtures', 'clipboard-source.js']),
        'Clipboard X Gnome XWayland source',
      ]);
      const capturedXwaylandSource = await waitUntil(
        () => indicator._controller.items.some(item => item.text === 'Clipboard X Gnome XWayland source'),
      );
      await waitForExit(xwaylandSource);
      assert(xwaylandSource.get_successful(),
        'XWayland clipboard source exited with an error');
      assert(capturedXwaylandSource,
        'Clipboard X Gnome did not capture an XWayland application source');
    }

    for (let index = 0; index < 50; index++)
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, `rapid clipboard change ${index}`);
    await Scripting.sleep(800);
    assert(indicator._controller.items.some(item => item.text === 'rapid clipboard change 49'),
      'Clipboard X Gnome lost the final value during rapid clipboard changes');
  } finally {
    indicator.menu.close();
    indicator._controller.remove(capturedText.id);
  }
}

async function images(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const deviceId = indicator._settings.get_string('device-id');
  const png = imageBytes();
  const content = extensionObject._content;
  const prepareFile = content.file;
  const publish = extensionObject._publish;
  const closeMenu = history._closeMenu;
  try {
    St.Clipboard.get_default().set_content(
      St.ClipboardType.CLIPBOARD,
      'image/png',
      new GLib.Bytes(png),
    );
    await Scripting.sleep(800);
    const imageItem = indicator._controller.items.find(item => item.isImage && item.preview?.path);
    assert(imageItem,
      'Clipboard X Gnome did not asynchronously create an image thumbnail');
    indicator._settings.set_string('editor-command', '');
    content.file = () => {
      throw new Error('Unconfigured editor should not materialize the image');
    };
    await extensionObject._editItem(imageItem);
    content.file = prepareFile;
    assert(await extensionObject._launchEditor('file:///tmp/unused-image.png') === null,
      'Unconfigured screenshot editor should not attempt to launch');
    indicator._settings.set_string('editor-command', '/usr/bin/true %f');
    await extensionObject._editItem(imageItem);
    assert(imageItem.primary.path, 'Immediate image editing did not persist a stable original path');
    const originalSyncEnabled = indicator._settings.get_boolean('sync-enabled');
    indicator._settings.set_boolean('sync-enabled', false);
    const originalPath = imageItem.primary.path;
    const originalBytes = imageItem.primary.bytes;
    imageItem.remote = true;
    imageItem.primary.path = null;
    imageItem.primary.bytes = null;
    let materializationAttempted = false;
    content.file = () => materializationAttempted = true;
    let editingError;
    try {
      await extensionObject._editItem(imageItem);
    } catch (error) {
      editingError = error;
    } finally {
      content.file = prepareFile;
      imageItem.primary.path = originalPath;
      imageItem.primary.bytes = originalBytes;
    }
    assert(editingError?.code === 'original_image_requires_sync' && !materializationAttempted,
      'Editing a remote preview with sync disabled must stop before requesting or launching the original');
    await extensionObject._editItem(imageItem);
    indicator._settings.set_boolean('sync-enabled', originalSyncEnabled);
    imageItem.remote = true;
    imageItem.primary.bytes = null;
    await content.read(imageItem);
    assert(imageItem.primary.bytes,
      'Previously downloaded remote content was not restored from local cache while offline');
    imageItem.remote = false;

    indicator._settings.set_boolean('sync-enabled', false);
    indicator.menu.open();
    history.syncButton.emit('clicked', 1);
    assert(indicator._settings.get_boolean('sync-enabled') && history.syncButton.selected
        && indicator.menu.isOpen,
      'The panel sync button must enable synchronization without closing the menu');
    history.syncButton.emit('clicked', 1);
    assert(!indicator._settings.get_boolean('sync-enabled') && !history.syncButton.selected,
      'The panel sync button must disable synchronization and update its selected state');
    indicator._settings.set_boolean('sync-enabled', true);
    assert(history.syncButton.selected, 'External sync settings changes must update the button');
    indicator.menu.close();
    indicator._settings.set_string('sync-send-mode', 'manual');
    const imageRow = history.entry(imageItem);
    const imageButtons = imageRow.focusActors;
    const editButton = imageButtons.find(actor => actor._clipboardXGnomeEntryAction === 'edit');
    assert(editButton, 'Image history row must expose its edit action');
    const imageBody = imageButtons[0].get_child();
    const imageContent = imageBody.get_children().find(child =>
      child.has_style_class_name?.('cbx-image-content'));
    const [imageThumbnail] = imageContent.get_children();
    // Layout sizes are only meaningful after the row is attached to an open menu.
    indicator.menu.open();
    history._section.addMenuItem(imageRow);
    assert(await waitUntil(() => imageThumbnail.mapped
        && imageThumbnail.width > 0 && imageThumbnail.height > 0),
      'Image history thumbnail did not receive a visible allocation');
    assert(Math.abs(imageThumbnail.width / imageThumbnail.height
          - imageItem.preview.width / imageItem.preview.height) < 0.01,
      `Image history thumbnail did not preserve the source aspect ratio (${imageThumbnail.width}×${imageThumbnail.height}, preview ${imageItem.preview.width}×${imageItem.preview.height})`);
    let editClosedMenu = false;
    history._closeMenu = () => editClosedMenu = true;
    editButton.emit('clicked', 1);
    await Scripting.sleep(100);
    assert(editClosedMenu, 'Editing an image history item did not close the panel');
    history._closeMenu = closeMenu;
    imageRow.destroy();
    indicator.menu.close();
    const transferId = GLib.uuid_string_random();
    const transfer = {
      transferId,
      itemId: imageItem.id,
      deviceId,
      kind: 'content',
      direction: 'download',
      state: 'transferring',
      completedBytes: 50,
      totalBytes: 100,
      peerDeviceIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      errorCode: '',
      errorMessage: '',
    };
    const progressButton = history._sync.button(imageItem);
    extensionObject._sync._transfers.receive(transfer);
    assert(progressButton.get_child() instanceof St.DrawingArea && progressButton.hint.includes('50%'),
      'Exact per-item transfer progress was not rendered as a ring');
    progressButton.destroy();
    indicator._settings.set_boolean('sync-enabled', false);
    assert(!extensionObject._sync.getTransferForItem(imageItem.id),
      'Restarted synchronization must clear authoritative transfer state');
    indicator._settings.set_boolean('sync-enabled', true);
    const retryButton = history._sync.button(imageItem);
    assert(!(retryButton.get_child() instanceof St.DrawingArea),
      'A newly rendered button must not inherit progress from the previous transfer session');
    let retriedPublishes = 0;
    const cancelTransfer = extensionObject._sync.cancelTransfer;
    extensionObject._publish = async () => retriedPublishes++;
    extensionObject._sync.cancelTransfer = async () => {
      throw new Error('A restarted button must not cancel a transfer from the previous session');
    };
    try {
      await history._sync._activate(imageItem);
      assert(retriedPublishes === 1,
        'An interrupted publication must be retryable after replacing the transfer session');
    } finally {
      extensionObject._publish = publish;
      extensionObject._sync.cancelTransfer = cancelTransfer;
      retryButton.destroy();
    }

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
    assert(automaticPublishes === 1, 'Automatic policy sent sensitive content');
    extensionObject._publish = publish;
    let sensitiveError = null;
    try {
      await extensionObject._publish(imageItem);
    } catch (error) {
      sensitiveError = error;
    }
    assert(sensitiveError?.code === 'sensitive_content',
      'Manual synchronization must reject sensitive content before persistence');
    const sensitiveRow = history.entry(imageItem);
    assert(!sensitiveRow.focusActors.some(actor => actor._clipboardXGnomeEntryAction === 'sync'),
      'Sensitive history entries must not expose a synchronization action');
    sensitiveRow.destroy();
    imageItem.sensitive = false;
    imageItem.favorite = false;
    indicator._settings.set_boolean('sync-favorites-only', false);
    indicator._settings.set_string('sync-send-mode', 'manual');
    indicator._settings.set_boolean('sync-enabled', false);
    const syncDisabledRow = history.entry(imageItem);
    assert(!syncDisabledRow.focusActors.some(actor => actor._clipboardXGnomeEntryAction === 'sync'),
      'Per-item synchronization UI remained visible while synchronization was disabled');
    syncDisabledRow.destroy();

    indicator._controller.remove(imageItem.id);
  } finally {
    content.file = prepareFile;
    extensionObject._publish = publish;
    history._closeMenu = closeMenu;
    indicator.menu.close();
  }
}

async function receiving(indicator, extensionObject) {
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const history = indicator._controller;
  const sync = extensionObject._sync;
  const getItem = sync.getItem;
  const materialize = sync.materialize;
  const item = ClipboardItem.fromText('received content reaches the real history panel', {
    originDeviceId: GLib.uuid_string_random(), remote: true, availability: 'preview',
  });
  item.primary.bytes = null;
  try {
    indicator._settings.set_string('sync-receive-mode', 'history');
    sync.getItem = async () => item;
    sync.materialize = async value => {
      value.primary.bytes = new GLib.Bytes(new TextEncoder().encode(value.preview.text));
      value.availability = 'ready';
    };
    await extensionObject._sync._applyChanges(
      [{kind: 'upsert', itemId: item.id}], {isCurrent: () => true},
    );
    assert(await waitUntil(() => item.availability === 'ready' && history.items.includes(item)),
      'The synchronization receiver was not wired to the real history');
    assert(history.search(item.text).some(value => value === item),
      'Received content must be exposed through the same searchable history as local content');
    indicator.menu.open();
    indicator._historyPanel.searchEntry.set_text(item.text);
    const displays = actor => actor instanceof St.Label && actor.text === item.text
      || actor.get_children().some(displays);
    assert(await waitUntil(() => displays(indicator._historyPanel._section.actor)),
      'The history panel did not display received content');

    // Only this narrow check needs the actual Controller. The async receiver
    // and storage cases live in the isolated content integration test.
    indicator._settings.set_int('cache-size-mib', 16);
    const oversized = ClipboardItem.fromText('lazy original exceeds local capacity', {
      originDeviceId: GLib.uuid_string_random(), remote: true, availability: 'preview',
    });
    oversized.primary.bytes = null;
    oversized.primary.size = 17 * 1024 * 1024;
    history.add(oversized, 'remote');
    assert(history.items.includes(oversized), 'A lightweight snapshot should fit before download');
    oversized.primary.bytes = new GLib.Bytes(new Uint8Array([1]));
    oversized.availability = 'ready';
    assert(!history.commitContent(oversized) && !history.items.includes(oversized),
      'Committing downloaded originals must immediately reapply the storage budget');
  } finally {
    sync.getItem = getItem;
    sync.materialize = materialize;
    history.remove(item.id);
    indicator._historyPanel.searchEntry.set_text('');
    indicator.menu.close();
  }
}

async function startupHistory(indicator, extensionObject) {
  const {ClipboardController} = await import(`${extensionObject.dir.get_uri()}/clipboard/controller.js`);
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const {HistoryStore} = await import(`${extensionObject.dir.get_uri()}/clipboard/history/store.js`);
  const settings = {
    get_string: key => indicator._settings.get_string(key),
    get_boolean: key => key === 'private-mode' || indicator._settings.get_boolean(key),
    get_int: key => ({'history-size': 10, 'cache-size-mib': 16, 'history-retention-days': 1})[key],
    connect: () => 0,
    disconnect() {},
  };
  const deleteFixture = file => {
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
      const enumerator = file.enumerate_children(Gio.FILE_ATTRIBUTE_STANDARD_NAME,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
      try {
        let info;
        while ((info = enumerator.next_file(null)))
          deleteFixture(file.get_child(info.get_name()));
      } finally { enumerator.close(null); }
    }
    file.delete(null);
  };
  for (const mode of ['automatic', 'immediate-shutdown', 'unchanged']) {
    const rootPath = GLib.dir_make_tmp('clipboard-x-startup-history-XXXXXX');
    const controller = new ClipboardController(settings);
    const store = new HistoryStore({rootPath, deviceId: indicator._settings.get_string('device-id'),
      items: () => controller.items});
    controller._store = store;
    try {
      const old = Date.now() - 2 * 86_400_000;
      const expired = ClipboardItem.fromText(`Expired startup fixture ${mode}`, {createdAt: old});
      const current = ClipboardItem.fromText(`Current startup fixture ${mode}`);
      const pinned = ClipboardItem.fromText(`Pinned startup fixture ${mode}`, {createdAt: old, favorite: true});
      const seed = mode === 'unchanged' ? [current, pinned] : [expired, current, pinned];
      await store.save(seed);
      const generation = store._saveGeneration;
      const expiredFile = mode === 'unchanged' ? null : Gio.File.new_for_path(expired.primary.path);
      const persistedItems = () => {
        const [, bytes] = Gio.File.new_for_path(store.directory().index).load_contents(null);
        return JSON.parse(new TextDecoder().decode(bytes)).items;
      };
      await controller.start();
      assert(!controller.error && controller.items.length === 2
          && controller.items.some(item => item.id === current.id)
          && controller.items.some(item => item.id === pinned.id),
        'Startup must retain current and pinned items while trimming expired regular items');
      if (mode === 'immediate-shutdown')
        await controller.destroy();
      else if (mode === 'automatic')
        assert(await waitUntil(() => !expiredFile.query_exists(null)
            && !persistedItems().some(item => item.id === expired.id)),
          'Startup pruning must persist and collect expired files without a later clipboard capture');
      else {
        await Scripting.sleep(200);
        assert(controller._saveRevision === 0 && store._saveGeneration === generation,
          'Starting unchanged history must not schedule or perform an unnecessary save');
      }
      if (expiredFile)
        assert(!expiredFile.query_exists(null), 'Pruned startup content must not survive immediate shutdown');
      const saved = persistedItems();
      assert(saved.length === 2 && saved.some(item => item.id === current.id)
          && saved.some(item => item.id === pinned.id)
          && Gio.File.new_for_path(current.primary.path).query_exists(null)
          && Gio.File.new_for_path(pinned.primary.path).query_exists(null),
        'The persisted startup index must contain exactly the retained current and pinned items');
    } finally {
      await controller.destroy();
      deleteFixture(Gio.File.new_for_path(rootPath));
    }
  }
}

async function screenshots(indicator, extensionObject) {
  const png = imageBytes();
  const screenshotPortal = extensionObject._portal;
  const launchEditor = extensionObject._launchEditor;
  const [screenshotFile, screenshotStream] = Gio.File.new_tmp('clipboard-x-gnome-screenshot-pipeline-XXXXXX.png');
  try {
    screenshotStream.get_output_stream().write_all(png, null);
    screenshotStream.close(null);
    extensionObject._portal = {
      capture: async target => {
        assert(target === 'screen', 'Screenshot pipeline ignored the configured target');
        return screenshotFile.get_uri();
      },
      cancel() {},
    };
    let launchedEditorUri = null;
    extensionObject._launchEditor = async uri => {
      launchedEditorUri = uri;
    };
    indicator._settings.set_string('screenshot-target', 'screen');
    indicator._settings.set_boolean('screenshot-add-history', true);
    indicator._settings.set_boolean('screenshot-write-clipboard', true);
    indicator._settings.set_boolean('screenshot-open-editor', true);
    await extensionObject._takeScreenshot();
    await Scripting.sleep(300);
    const screenshotItem = indicator._controller.items.find(item => item.isImage);
    assert(screenshotItem?.primary.path && screenshotItem.preview?.path
        && Gio.File.new_for_path(screenshotItem.preview.path).query_exists(null),
      'Screenshot pipeline did not persist both the original image and its thumbnail');
    assert(launchedEditorUri === screenshotFile.get_uri(),
      'Screenshot editor did not receive the URI returned by the portal');
    assert(indicator._controller._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD).includes('image/png'),
      'Screenshot pipeline did not write the image to the clipboard');

    indicator._settings.set_boolean('screenshot-add-history', false);
    const beforeScreenshot = 'Before screenshot without history';
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, beforeScreenshot);
    assert(await waitUntil(() => indicator._controller.items.some(item => item.text === beforeScreenshot)),
      'The screenshot clipboard baseline was not captured');
    await indicator._controller.persist();
    const historyCount = indicator._controller.items.length;
    const stagedPaths = new Set(indicator._controller._store._staged.keys());
    for (let attempt = 0; attempt < 3; attempt++) {
      launchedEditorUri = null;
      await extensionObject._takeScreenshot();
      assert([...indicator._controller._store._staged.keys()].every(path => stagedPaths.has(path)),
        'Screenshots without history must not accumulate unused staged thumbnails');
      assert(launchedEditorUri === screenshotFile.get_uri()
          && indicator._controller._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD).includes('image/png'),
        'Screenshots without history must still copy the image and launch its editor');
    }
    await Scripting.sleep(300);
    assert(indicator._controller.items.length === historyCount,
      'Screenshot configured without history was captured again through clipboard owner change');
    await interruptedScreenshots(extensionObject, screenshotFile.get_uri());
  } finally {
    extensionObject._launchEditor = launchEditor;
    extensionObject._portal = screenshotPortal;
    if (!screenshotStream.is_closed())
      screenshotStream.close(null);
    screenshotFile.delete(null);
    indicator.menu.close();
  }
}

async function interruptedScreenshots(extensionObject, uri) {
  const controller = extensionObject._controller;
  const portal = extensionObject._portal;
  const launchEditor = extensionObject._launchEditor;
  const createFromUri = controller.createFromUri;
  const writeScreenshot = controller.writeScreenshot;
  for (const phase of ['portal', 'prepare', 'write']) {
    let release;
    let entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    let newSessionCalls = 0;
    let editorCalls = 0;
    const replacement = {
      createFromUri: async () => { newSessionCalls++; return {primary: {}}; },
      addFromUri: async () => { newSessionCalls++; return {primary: {}}; },
      writeScreenshot: async () => { newSessionCalls++; },
    };
    extensionObject._portal = {
      async capture() {
        if (phase === 'portal') {
          entered();
          await gate;
        }
        return uri;
      },
      cancel() {},
    };
    controller.createFromUri = async (...args) => {
      const item = await createFromUri.apply(controller, args);
      if (phase === 'prepare') {
        entered();
        await gate;
      }
      return item;
    };
    controller.writeScreenshot = async () => {
      assert(phase === 'write', 'An interrupted screenshot reached clipboard publication too early');
      entered();
      await gate;
    };
    extensionObject._launchEditor = async () => { editorCalls++; };
    const pending = extensionObject._takeScreenshot().then(() => null, error => error);
    try {
      await Promise.race([started, pending.then(error => {
        throw error ?? new Error(`Screenshot completed before reaching the ${phase} checkpoint`);
      })]);
      // Model the identity change made by disable/re-enable without replacing
      // the complete Shell session exercised by the final lifecycle scenario.
      extensionObject._controller = replacement;
      release();
      const error = await pending;
      assert(!error || error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
        `Interrupting the ${phase} phase must settle normally or with cancellation`);
      assert(newSessionCalls === 0 && editorCalls === 0,
        `An old screenshot completing ${phase} must not touch the new controller or launch its editor`);
    } finally {
      release();
      await pending;
      extensionObject._controller = controller;
      extensionObject._portal = portal;
      extensionObject._launchEditor = launchEditor;
      controller.createFromUri = createFromUri;
      controller.writeScreenshot = writeScreenshot;
    }
  }
}

async function colorsAndLifecycle(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const deviceId = indicator._settings.get_string('device-id');
  assert(/^[0-9a-f-]{36}$/u.test(deviceId), 'Opening Clipboard X Gnome did not create a DeviceId');
  extensionObject._pickColor();
  await Scripting.sleep(500);
  assert(extensionObject._colorPicker, 'Color picker did not acquire a modal overlay');
  assert(extensionObject._colorPicker._rgb?.length === 3, 'Color picker did not sample the stage texture');
  const pickedColor = extensionObject._colorPicker;
  const [pickerX, pickerY] = pickedColor._coords;
  const pixelX = Math.round(pickerX * pickedColor._scale);
  const movementKey = pixelX < pickedColor._texture.get_width() - 1
    ? Clutter.KEY_Right : Clutter.KEY_Left;
  pickedColor.vfunc_key_press_event({
    get_key_symbol: () => movementKey,
    get_state: () => 0,
  });
  await Scripting.sleep(100);
  assert(Math.abs(Math.round(pickedColor._coords[0] * pickedColor._scale) - pixelX) === 1
      && pickedColor._coords[1] === pickerY,
    'Color picker keyboard movement did not advance by one screenshot pixel cell');
  pickedColor._onPicked(pickedColor._rgb);
  pickedColor.close();
  await Scripting.sleep(300);
  assert(!extensionObject._colorPicker, 'Color picker did not release its modal overlay');
  assert(extensionObject._colorPickerDestroySignal === 0,
    'Completed color picking retained the destroy signal ID');
  assert(indicator._controller.items.some(item => item.text.startsWith('#')),
    'Picked color did not enter clipboard history');
  const colorItem = indicator._controller.items.find(item => item.text.startsWith('#'));
  const colorRow = history.entry(colorItem);
  const colorContentBody = colorRow.focusActors[0].get_child();
  const colorSwatch = colorContentBody.get_children().find(child =>
    child.has_style_class_name?.('cbx-color-swatch'));
  assert(colorSwatch, 'Color clipboard content did not display a color swatch');
  colorRow.destroy();
  indicator._controller.toggleFavorite(colorItem.id);
  indicator._controller.clear();
  assert(indicator._controller.items.length === 1 && indicator._controller.items[0] === colorItem,
    'Clearing history did not preserve only favorited entries');

  extensionObject._pickColor();
  await Scripting.sleep(300);
  const cancelledPicker = extensionObject._colorPicker;
  cancelledPicker.vfunc_key_press_event({
    get_key_symbol: () => Clutter.KEY_Escape,
    get_state: () => 0,
  });
  await Scripting.sleep(100);
  assert(!extensionObject._colorPicker, 'Escape did not cancel and release the color picker');
  assert(extensionObject._colorPickerDestroySignal === 0,
    'Cancelled color picking retained the destroy signal ID');

  extensionObject._pickColor();
  await Scripting.sleep(300);
  assert(extensionObject._colorPicker, 'Color picker did not reopen for lifecycle testing');

  const oldController = extensionObject._controller;
  const oldSync = extensionObject._sync;
  Main.extensionManager.disableExtension(UUID);
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME], 'Indicator remained after disabling Clipboard X Gnome');
  assert(!extensionObject._colorPicker, 'Disabling Clipboard X Gnome did not close the active color picker');
  assert(extensionObject._colorPickerDestroySignal === 0,
    'Disabling Clipboard X Gnome did not clear the color picker destroy signal ID');
  assert(oldController._destroyed && oldController._selectionSignal === 0
      && oldController._settingsSignals.length === 0,
  'Disabling Clipboard X Gnome did not release clipboard and settings subscriptions');
  assert(oldSync._destroyed && oldSync._pollSource === 0 && !oldSync._transfers.current,
  'Disabling Clipboard X Gnome did not release synchronization polling, requests or transfer waiters');
  assert(!extensionObject._shortcutBound, 'Disabling Clipboard X Gnome did not remove its shortcut');

  Main.extensionManager.enableExtension(UUID);
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X Gnome did not recover after being enabled again');
  assert(indicator._settings.get_string('device-id') === deviceId,
    'DeviceId changed after the extension was disabled and enabled again');
  assert(indicator._controller.items.some(item => item.favorite && item.text === colorItem.text),
    'Favorited clipboard history did not survive extension restart');

  Main.sessionMode.pushMode('unlock-dialog');
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME],
    'Clipboard X Gnome remained active after the session entered its lock mode');
  Main.sessionMode.popMode('unlock-dialog');
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X Gnome did not recover after the session left its lock mode');
  assert(indicator._settings.get_string('device-id') === deviceId,
    'DeviceId changed across the lock/unlock lifecycle');

  Gio.Subprocess.new([
    '/usr/bin/python3',
    GLib.build_filenamev([TEST_DIRECTORY, '..', 'fixtures', 'pause-process.py']),
    `${new Gio.Credentials().get_unix_pid()}`,
  ], Gio.SubprocessFlags.NONE);
  await Scripting.sleep(900);
  assert(Main.panel.statusArea[STATUS_AREA_NAME],
    'Clipboard X Gnome did not survive a nested Shell process suspend/resume cycle');
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'clipboard after simulated resume');
  await Scripting.sleep(400);
  assert(indicator._controller.items.some(item => item.text === 'clipboard after simulated resume'),
    'Clipboard capture did not recover after the simulated resume cycle');
}
