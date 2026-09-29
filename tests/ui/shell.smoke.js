import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

const UUID = 'clipboard-x@guleoo.github.io';
const STATUS_AREA_NAME = 'clipboard-x';
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

function foreground(actor) {
  const color = actor.get_theme_node().get_foreground_color();
  return [color.red, color.green, color.blue, color.alpha];
}

function deleteTree(file) {
  if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
    const enumerator = file.enumerate_children(
      Gio.FILE_ATTRIBUTE_STANDARD_NAME,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
    let info;
    while ((info = enumerator.next_file(null)))
      deleteTree(file.get_child(info.get_name()));
    enumerator.close(null);
  }
  file.delete(null);
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

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;

  const extension = Main.extensionManager.lookup(UUID);
  assert(extension, 'Clipboard X extension was not installed');
  assert(extension.enabled, `Clipboard X was not enabled (${extension.error ?? 'unknown error'})`);

  await waitUntil(() => Boolean(Main.panel.statusArea[STATUS_AREA_NAME]), 3000);
  if (!Main.panel.statusArea[STATUS_AREA_NAME]) {
    Main.extensionManager.disableExtension(UUID);
    await Scripting.sleep(100);
    Main.extensionManager.enableExtension(UUID);
    await waitUntil(() => Boolean(Main.panel.statusArea[STATUS_AREA_NAME]), 3000);
  }
  let indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, `Clipboard X indicator was not added to the panel (${extension.error ?? 'no extension error'})`);
  const history = indicator._historyPanel;
  for (const item of indicator._controller.items)
    indicator._controller.remove(item.id);
  await Scripting.sleep(200);
  const expectedSearchTranslation = GLib.getenv('CLIPBOARD_X_EXPECT_SEARCH_TRANSLATION')
    ?? (GLib.getenv('CLIPBOARD_X_EXPECT_CHINESE') === '1' ? '搜索剪切板历史…' : null);
  if (expectedSearchTranslation) {
    assert(history.searchEntry.hint_text === expectedSearchTranslation,
      `Clipboard X translation was not loaded (${history.searchEntry.hint_text})`);
    if (GLib.getenv('CLIPBOARD_X_TRANSLATION_ONLY') === '1')
      return;
  }

  indicator.menu.open();
  await Scripting.sleep(200);
  assert(indicator.menu.isOpen, 'Clipboard X menu did not open');
  assert(history.searchEntry._clipboardXControlType === 'search-entry'
      && history.screenshotButton._clipboardXControlType === 'icon-button'
      && history.footer._clipboardXControlType === 'panel-footer'
      && history.footer.divider !== null,
    'Shared search, icon or footer controls were not used by the history panel');
  assert(indicator._tokenizer.header._clipboardXControlType === 'panel-header'
      && indicator._tokenizer.header.divider !== null
      && indicator._tokenizer.backButton.get_child().translation_x === 1
      && indicator._tokenizer.footer._clipboardXControlType === 'panel-footer',
    'Tokenizer panel did not use the shared header and footer controls');
  assert(indicator.menu.actor.width === indicator._settings.get_int('panel-width'),
    'Configured panel width was not enforced on the popup actor');
  assert(indicator._settings.get_default_value('panel-height').deepUnpack() === 400,
    'Default panel height must be 400 logical pixels');
  assert(Number.isFinite(history.captureView().scrollValue),
    'Clipboard history view state could not read the GNOME 50 scroll adjustment');
  const originalTextOffset = indicator._settings.get_int('panel-text-vertical-offset');
  indicator._settings.set_int('panel-text-vertical-offset', -1);
  assert(history.searchEntry.clutter_text.translation_y === -1
      && history.searchEntry.get_hint_actor().translation_y === -2
      && indicator._tokenizer.titleLabel.translation_y === -2
      && indicator._tooltip.actor.translation_y === -1,
  'Configured text offset did not preserve special optical baseline corrections');
  indicator._settings.set_int('panel-text-vertical-offset', originalTextOffset);
  assert(history.searchEntry.get_hint_actor().margin_left === 2,
    'Search placeholder did not retain its configured left margin');
  assert([history.searchEntry, history.searchEntry.clutter_text].includes(global.stage.get_key_focus()),
    'Opening an empty history panel must fall back to its search entry');
  assert(history.toolbar.get_children().length === 3,
    'Top toolbar must contain only screenshot, color picker and quick-phrase actions');
  assert(history.searchEntry.get_parent() === history.toolbar.get_parent(),
    'Search and the three primary tools must share one row');
  assert(history.phrasesButton.get_parent() === history.toolbar
      && history.privateButton.get_parent() === history.footer.row,
    'Quick-phrase and privacy buttons were not swapped');
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
  await indicator._quickPhrases.ready;
  const originalPhrases = indicator._quickPhrases.phrases;
  await indicator._quickPhrases.replace(['Local smoke-test phrase']);
  indicator._openPhrases();
  await Scripting.sleep(100);
  assert(indicator._panelManager.is('phrases')
      && indicator._panelManager.geometry.width === resizedPanelWidth
      && indicator._panelManager.geometry.height === resizedPanelHeight
      && Math.round(indicator.menu.actor.width) === resizedPanelWidth
      && Math.abs(Math.round(indicator.menu.actor.height) - resizedHistoryMenuHeight) <= 1
      && Math.round(indicator._quickPhrases.actor.height) === resizedPanelHeight
      && indicator._quickPhrases.buttons.length === 1
      && indicator._quickPhrases.header._clipboardXControlType === 'panel-header'
      && indicator._quickPhrases.header.divider !== null
      && indicator._quickPhrases.rows[0]._clipboardXControlType === 'content-item'
      && indicator._quickPhrases.buttons[0].has_style_class_name('cbx-entry-content')
      && indicator._quickPhrases.rows[0].get_children().some(child =>
        child instanceof St.Button && child.get_child()?.icon_name === 'user-trash-symbolic'),
  `Saved-phrase panel did not match history geometry (${Math.round(indicator.menu.actor.height)} vs ${resizedHistoryMenuHeight})`);
  assert(global.stage.get_key_focus() === indicator._quickPhrases.focusAnchor
      && indicator._quickPhrases.focusAnchor.opacity === 0
      && indicator._quickPhrases.focusAnchor.width === 0
      && indicator._quickPhrases.focusAnchor.height === 0,
  'Quick phrases did not start on its invisible focus anchor');
  assert(indicator._quickPhrases.focusAnchor.handle(capturedKeyEvent(Clutter.KEY_Right))
      === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === indicator._quickPhrases.buttons[0],
  'The quick-phrase anchor did not consume Right and focus the first phrase');
  const phraseForeground = foreground(indicator._quickPhrases.buttons[0]);
  assert(phraseForeground[3] >= 240
      && indicator._quickPhrases.rows[0].focusActors.every(actor =>
        foreground(actor).join(',') === phraseForeground.join(',')),
    'Quick-phrase content and actions did not use the shared content-item foreground');
  indicator._quickPhrases.showForm();
  assert(indicator._quickPhrases.form.get_children().length === 1,
    'Quick-phrase form must contain only the text entry');
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
  assert(!indicator.menu.isOpen, 'Clipboard X menu did not close');
  indicator._settings.set_string('theme-color', '#123456');
  await Scripting.sleep(50);
  assert(indicator._customAccentColor === '#123456',
    'A custom theme color did not reach the panel');
  indicator._settings.set_string('theme-color', 'system');
  await Scripting.sleep(50);
  assert(indicator._customAccentColor === null,
    'Following the system theme did not clear the custom accent override');

  const deviceId = indicator._settings.get_string('device-id');
  assert(/^[0-9a-f-]{36}$/u.test(deviceId), 'Opening Clipboard X did not create a DeviceId');
  const extensionObject = Main.panel.statusArea[STATUS_AREA_NAME]?._actions?.extensionObject
    ?? Main.extensionManager._extensionOrder?.find?.(candidate => candidate.uuid === UUID)
    ?? extension.stateObj;
  assert(extensionObject, 'Clipboard X extension object is unavailable');
  const terminalInput = extensionObject._terminalInput;
  const modifierState = terminalInput._modifierState;
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
  const cancelledCallback = terminalInput._onCancelled;
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
  terminalInput._typing = null;
  terminalInput._monitoring = false;
  terminalInput._emitting = false;
  terminalInput._onCancelled = cancelledCallback;

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

  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'Clipboard X smoke test 你好 👋');
  await Scripting.sleep(500);
  assert(indicator._controller.items.some(item => item.text.includes('smoke test')),
    'Clipboard X did not capture a text clipboard change');
  const capturedText = indicator._controller.items.find(item => item.text.includes('smoke test'));
  indicator.menu.open();
  await Scripting.sleep(100);
  const renderedHistoryRow = history._section.actor.get_children().find(actor =>
    actor._clipboardXControlType === 'content-item');
  assert([history.searchEntry, history.searchEntry.clutter_text].includes(global.stage.get_key_focus()),
    'Opening clipboard history did not focus its search entry');
  assert(renderedHistoryRow?.focusActors.every(actor =>
    foreground(actor).join(',') === phraseForeground.join(',')),
  'Clipboard history content and actions did not use the shared content-item foreground');
  indicator.menu.close();
  await Scripting.sleep(100);
  const capturedRow = history.entry(capturedText);
  const capturedContentBody = capturedRow.focusActors[0].get_child();
  assert(capturedRow._clipboardXControlType === 'content-item'
      && capturedRow.focusActors.length === capturedRow._clipboardXFocusRow.length
      && capturedRow.focusActors[0].has_style_class_name('cbx-entry-content')
      && capturedContentBody.has_style_class_name('cbx-entry-body')
      && !capturedContentBody.get_children().some(child =>
        child.has_style_class_name?.('cbx-color-swatch')),
    'Clipboard history did not group its leading content inside the shared content action');
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
  assert(!deviceRow.get_children().some(child =>
    child.has_style_class_name?.('cbx-device-icon'))
      && deviceContentBody.get_children().some(child =>
        child.has_style_class_name?.('cbx-device-icon')),
  'Remote clipboard device identity was not grouped with the entry content');
  deviceRow.destroy();
  history._multipleDevices = false;
  capturedRow.destroy();
  assert(indicator._controller.search('SMOKE TEST').includes(capturedText),
    'Case-insensitive clipboard history search did not find the expected entry');
  const originalTypeItem = indicator._actions.typeItem;
  const originalPasteItem = indicator._actions.pasteItem;
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
  history.handleEntryKey(capturedText, entryEvent(Clutter.KEY_p));
  assert(capturedText.favorite, 'Clipboard entry p shortcut did not pin the entry');
  history.handleEntryKey(capturedText, entryEvent(Clutter.KEY_p));
  assert(!capturedText.favorite, 'Clipboard entry p shortcut did not unpin the entry');
  indicator._controller.toggleFavorite(capturedText.id);
  assert(capturedText.favorite, 'Clipboard history entry could not be favorited');
  const pinnedRow = history.entry(capturedText);
  assert(pinnedRow._clipboardXFocusRow.every(child => child._clipboardXHistoryRow === pinnedRow),
    'Clipboard history entry controls did not retain their focus matrix row');
  assert(pinnedRow.get_children().some(child => child instanceof St.Button
      && child.get_child()?.icon_name === 'view-pin-symbolic'
      && child.has_style_class_name('cbx-pinned')),
  'Pinned history entry did not keep the pin icon with a distinct color class');
  assert(pinnedRow.get_children().some(child => child instanceof St.Button
      && child.get_child()?.icon_name === 'user-trash-symbolic'),
  'Clipboard history entry did not use the standard trash icon');
  pinnedRow.destroy();
  indicator._controller.toggleFavorite(capturedText.id);
  assert(!capturedText.favorite, 'Clipboard history entry could not be unfavorited');
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
  assert(tokenButtons.length === tokenState.tokens.length,
    'Text segmentation did not render one visible button for each token');
  assert(tokenButtons.every(button => button.mapped && button.width > 0 && button.height > 0),
    'Text segmentation rendered token buttons outside the visible layout');
  assert(global.stage.get_key_focus() === indicator._tokenizer.focusAnchor
      && indicator._tokenizer.focusAnchor.opacity === 0
      && indicator._tokenizer.focusAnchor.width === 0
      && indicator._tokenizer.focusAnchor.height === 0,
  'Opening the tokenizer did not focus its invisible anchor');
  assert(indicator._tokenizer.focusAnchor.handle(capturedKeyEvent(Clutter.KEY_Right))
      === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === tokenButtons[0],
  'The tokenizer anchor did not consume Right and focus the first token');
  assert(!indicator._tokenizer.sourceLabel.visible,
    'Disabled source preview remained visible in the tokenizer');
  assert(tokenButtons.every(button => !button._clipboardXHintConnected),
    'Tokenizer buttons unexpectedly registered tooltip handlers');
  assert(indicator._tokenizer.handleKey(
    tokenButtons[0], entryEvent(Clutter.KEY_Right),
  ) === Clutter.EVENT_PROPAGATE
      && indicator._handleMenuKey(entryEvent(Clutter.KEY_Right)) === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === tokenButtons[1],
  'Right Arrow did not move focus to the next token');
  const lastTokenButton = tokenButtons.at(-1);
  lastTokenButton.grab_key_focus();
  assert(indicator._tokenizer.handleKey(
    lastTokenButton, entryEvent(Clutter.KEY_Right),
  ) === Clutter.EVENT_PROPAGATE,
  'Tokenizer edge navigation did not continue into the surrounding panel');
  assert(indicator._handleMenuKey(entryEvent(Clutter.KEY_Right)) === Clutter.EVENT_STOP
      && isDescendant(global.stage.get_key_focus(), indicator.menu.actor),
  'Confined tokenizer focus escaped at the final token');
  indicator._settings.set_boolean('panel-confine-focus', false);
  assert(indicator._handleMenuKey(entryEvent(Clutter.KEY_Right)) === Clutter.EVENT_PROPAGATE,
  'Disabled focus confinement still consumed an edge arrow key');
  indicator._settings.set_boolean('panel-confine-focus', true);
  indicator._settings.set_boolean('tokenizer-show-source-preview', true);
  assert(indicator._tokenizer.sourceLabel.visible,
    'Enabled source preview was not shown immediately');
  tokenButtons[0].grab_key_focus();
  indicator._tokenizer.handleKey(
    tokenButtons[0], entryEvent(Clutter.KEY_Right, Clutter.ModifierType.SHIFT_MASK),
  );
  assert(tokenState.selected.has(tokenState.tokens[0].index)
      && tokenState.selected.has(tokenState.tokens[1].index)
      && global.stage.get_key_focus() === tokenButtons[1],
    'Shift+Arrow did not extend token selection and keyboard focus');
  tokenButtons[0].grab_key_focus();
  assert(indicator._tokenizer.handleKey(
    tokenButtons[0], entryEvent(Clutter.KEY_Up),
  ) === Clutter.EVENT_PROPAGATE
      && indicator._handleMenuKey(entryEvent(Clutter.KEY_Up)) === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === indicator._tokenizer.backButton,
  'Up Arrow did not move from the first token to the tokenizer back button');
  lastTokenButton.grab_key_focus();
  assert(indicator._tokenizer.handleKey(
    lastTokenButton, entryEvent(Clutter.KEY_Down),
  ) === Clutter.EVENT_PROPAGATE
      && indicator._handleMenuKey(entryEvent(Clutter.KEY_Down)) === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === indicator._tokenizer.copyButton,
  'Down Arrow did not move from the final token to the copy button');
  assert(indicator._handleMenuKey(entryEvent(Clutter.KEY_Down)) === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === indicator._tokenizer.copyButton,
  'Tokenizer copy button did not stop at the focus matrix boundary');
  tokenState.keyboardSelection = null;
  tokenButtons[0].grab_key_focus();
  indicator._tokenizer.handleKey(
    tokenButtons[0], entryEvent(Clutter.KEY_Right, Clutter.ModifierType.SHIFT_MASK),
  );
  assert(!tokenState.selected.has(tokenState.tokens[0].index)
      && !tokenState.selected.has(tokenState.tokens[1].index),
  'Shift+Arrow did not deselect a range anchored on a selected token');
  for (const button of tokenButtons)
    indicator._tokenizer.setSelected(button, false, false);
  tokenState.keyboardSelection = null;
  indicator._tokenizer.updateResult();
  indicator._tokenizer.beginSelectionDrag(tokenButtons[0]);
  const [secondTokenX, secondTokenY] = tokenButtons[1].get_transformed_position();
  const [secondTokenWidth, secondTokenHeight] = tokenButtons[1].get_transformed_size();
  indicator._tokenizer.applySelectionAt(
    secondTokenX + secondTokenWidth / 2,
    secondTokenY + secondTokenHeight / 2,
  );
  indicator._tokenizer.endSelectionDrag();
  assert(tokenState.selected.has(tokenState.tokens[0].index)
      && tokenState.selected.has(tokenState.tokens[1].index)
      && tokenButtons[0].checked && tokenButtons[1].checked,
    'Press-and-drag token selection did not select every visited token');
  indicator._tokenizer.setSelected(tokenButtons[1], false);
  assert(indicator._tokenizer.resultLabel.text === tokenState.tokens[0].text,
    'Selected token did not update the copy result preview');
  assert(indicator._tokenizer.resultLabel.get_parent() === indicator._tokenizer.footer.row
      && indicator._tokenizer.footer.get_parent() === indicator._tokenizer.actor,
    'Selected-token preview is not fixed outside the scrolling token area');
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
  const originalTimestamp = capturedText.createdAt;
  await indicator._controller.activate(capturedText);
  await Scripting.sleep(300);
  assert(capturedText.createdAt === originalTimestamp,
    'Programmatic clipboard activation was captured again instead of being loop-suppressed');

  indicator._settings.set_boolean('private-mode', true);
  assert(history.privateButton.checked
      && history.privateButton.has_style_class_name('cbx-private-active'),
  'Privacy mode button did not expose its selected visual state');
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'private clipboard value must not be recorded');
  await Scripting.sleep(300);
  assert(!indicator._controller.items.some(item => item.text.includes('private clipboard value')),
    'Private mode did not pause clipboard capture');
  indicator._settings.set_boolean('private-mode', false);
  assert(!history.privateButton.checked
      && history.privateButton.has_style_class_name('cbx-private-inactive'),
  'Privacy mode button did not return to its inactive visual state');

  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'disposable clipboard history entry');
  await Scripting.sleep(300);
  const disposable = indicator._controller.items.find(item => item.text === 'disposable clipboard history entry');
  assert(disposable, 'Disposable history fixture was not captured');
  history.handleEntryKey(disposable, entryEvent(Clutter.KEY_Delete));
  assert(!indicator._controller.items.includes(disposable), 'Clipboard history entry could not be deleted');

  if (GLib.getenv('CLIPBOARD_X_SKIP_EXTERNAL_SOURCES') !== '1') {
    const waylandSource = Gio.Subprocess.new(
      ['/usr/bin/wl-copy', '--foreground', '--type', 'text/plain;charset=utf-8'],
      Gio.SubprocessFlags.STDIN_PIPE,
    );
    const waylandInput = waylandSource.get_stdin_pipe();
    waylandInput.write_all(
      new TextEncoder().encode('Clipboard X native Wayland source'),
      null,
    );
    waylandInput.close(null);
    let capturedWaylandSource = await waitUntil(
      () => indicator._controller.items.some(item => item.text === 'Clipboard X native Wayland source'),
      500,
    );
    if (!capturedWaylandSource) {
      await indicator._controller.capture();
      capturedWaylandSource = await waitUntil(
        () => indicator._controller.items.some(item => item.text === 'Clipboard X native Wayland source'),
      );
    }
    const waylandMimeTypes = indicator._controller._selection
      .get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD);
    waylandSource.force_exit();
    assert(capturedWaylandSource,
      `Clipboard X did not capture a native Wayland application source (${waylandMimeTypes.join(', ')})`);

    const xwaylandLauncher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    xwaylandLauncher.setenv('GDK_BACKEND', 'x11', true);
    const xwaylandSource = xwaylandLauncher.spawnv([
      '/usr/bin/gjs',
      '-m',
      GLib.build_filenamev([TEST_DIRECTORY, '..', 'fixtures', 'clipboard-source.js']),
      'Clipboard X XWayland source',
    ]);
    await Scripting.sleep(800);
    assert(!xwaylandSource.get_if_exited() || xwaylandSource.get_successful(),
      'XWayland clipboard source exited with an error');
    assert(indicator._controller.items.some(item => item.text === 'Clipboard X XWayland source'),
      'Clipboard X did not capture an XWayland application source');
  }

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
  const imageItem = indicator._controller.items.find(item => item.isImage && item.preview?.path);
  assert(imageItem,
    'Clipboard X did not asynchronously create an image thumbnail');
  assert(imageItem.primary.delivery === 'eager', 'small clipboard image did not use eager delivery');
  indicator._settings.set_string('editor-command', '');
  const ensureMaterialized = extensionObject._ensureMaterialized;
  extensionObject._ensureMaterialized = () => {
    throw new Error('Unconfigured editor should not materialize the image');
  };
  await extensionObject._editItem(imageItem);
  extensionObject._ensureMaterialized = ensureMaterialized;
  assert(await extensionObject._launchEditor('file:///tmp/unused-image.png') === null,
    'Unconfigured screenshot editor should not attempt to launch');
  indicator._settings.set_string('editor-command', '/usr/bin/true %f');
  await extensionObject._editItem(imageItem);
  assert(imageItem.primary.path, 'Immediate image editing did not persist a stable original path');
  imageItem.remote = true;
  imageItem.primary.bytes = null;
  await extensionObject._ensureMaterialized(imageItem);
  assert(imageItem.primary.bytes,
    'Previously downloaded remote content was not restored from local cache while offline');
  imageItem.remote = false;

  indicator._settings.set_boolean('sync-enabled', true);
  indicator._settings.set_string('sync-send-mode', 'manual');
  const originalPreviewWidth = imageItem.preview.width;
  const originalPreviewHeight = imageItem.preview.height;
  imageItem.preview.width = 200;
  imageItem.preview.height = 100;
  const imageRow = history.entry(imageItem);
  const imageButtons = imageRow.get_children().filter(child => child instanceof St.Button);
  assert(imageButtons.length === 5,
    'Image history row must expose content, edit, pin, synchronization and delete actions');
  const imageBody = imageButtons[0].get_child();
  const imageContent = imageBody.get_children().find(child =>
    child.has_style_class_name?.('cbx-image-content'));
  const [imageThumbnail, imageMetadata] = imageContent.get_children();
  assert(imageThumbnail.width === 80 && imageThumbnail.height === 40,
    'Image history thumbnail was not scaled proportionally within its fixed preview height');
  assert(!(imageThumbnail instanceof St.Icon),
    'Image history thumbnail used a square icon renderer instead of image texture content');
  assert(imageMetadata.text.startsWith('PNG · ') && !imageMetadata.text.includes('image/'),
    'Image history metadata did not show only the image format and size');
  const closeMenu = history._closeMenu;
  let editClosedMenu = false;
  history._closeMenu = () => editClosedMenu = true;
  imageButtons[1].emit('clicked');
  await Scripting.sleep(100);
  assert(editClosedMenu, 'Editing an image history item did not close the panel');
  history._closeMenu = closeMenu;
  imageRow.destroy();
  imageItem.preview.width = originalPreviewWidth;
  imageItem.preview.height = originalPreviewHeight;
  imageItem.remote = true;
  imageItem.availability = 'preview';
  const remoteButton = history._sync.button(imageItem);
  assert(remoteButton.get_child().icon_name === 'folder-download-symbolic',
    'Remote image preview did not expose its lazy download action');
  imageItem.availability = 'failed';
  history._sync._update(imageItem, remoteButton);
  assert(remoteButton.get_child().icon_name === 'view-refresh-symbolic',
    'Retryable remote image failure did not expose a retry action');
  remoteButton.destroy();
  imageItem.remote = false;
  imageItem.availability = 'ready';

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
  indicator.setTransfer(transfer);
  assert(progressButton.get_child() instanceof St.DrawingArea && progressButton._hintText.includes('50%'),
    'Exact per-item transfer progress was not rendered as a ring');
  indicator.setTransfer({...transfer, state: 'expired', errorMessage: 'expired', updatedAt: Date.now() + 1});
  assert(progressButton._hintText.includes('expired'), 'Expired transfer did not expose a retryable error');
  progressButton.destroy();

  const publish = extensionObject._publish;
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
  assert(sensitiveRow.get_children().filter(child => child instanceof St.Button).length === 4,
    'Sensitive history entries must not expose a synchronization action');
  sensitiveRow.destroy();
  imageItem.sensitive = false;
  imageItem.favorite = false;
  indicator._settings.set_boolean('sync-favorites-only', false);
  indicator._settings.set_string('sync-send-mode', 'manual');
  indicator._settings.set_boolean('sync-enabled', false);
  const syncDisabledRow = history.entry(imageItem);
  assert(syncDisabledRow.get_children().filter(child => child instanceof St.Button).length === 4,
    'Per-item synchronization UI remained visible while synchronization was disabled');
  syncDisabledRow.destroy();

  indicator._controller.remove(imageItem.id);
  const [screenshotFile, screenshotStream] = Gio.File.new_tmp('clipboard-x-screenshot-pipeline-XXXXXX.png');
  screenshotStream.get_output_stream().write_all(png, null);
  screenshotStream.close(null);
  const screenshotPortal = extensionObject._portal;
  extensionObject._portal = {
    capture: async target => {
      assert(target === 'screen', 'Screenshot pipeline ignored the configured target');
      return screenshotFile.get_uri();
    },
    cancel() {},
  };
  const launchEditor = extensionObject._launchEditor;
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
  assert(screenshotItem?.primary.path,
    'Screenshot pipeline did not add and persist the image history snapshot');
  assert(launchedEditorUri === screenshotFile.get_uri(),
    'Screenshot editor did not receive the URI returned by the portal');
  assert(indicator._controller._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD).includes('image/png'),
    'Screenshot pipeline did not write the image to the clipboard');

  indicator._settings.set_boolean('screenshot-add-history', false);
  indicator._settings.set_boolean('screenshot-open-editor', false);
  const historyCount = indicator._controller.items.length;
  await extensionObject._takeScreenshot();
  await Scripting.sleep(300);
  assert(indicator._controller.items.length === historyCount,
    'Screenshot configured without history was captured again through clipboard owner change');
  extensionObject._launchEditor = launchEditor;
  extensionObject._portal = screenshotPortal;
  screenshotFile.delete(null);

  extensionObject._pickColor();
  await Scripting.sleep(500);
  assert(extensionObject._colorPicker, 'Color picker did not acquire a modal overlay');
  assert(extensionObject._colorPicker._rgb?.length === 3, 'Color picker did not sample the stage texture');
  const pickedColor = extensionObject._colorPicker;
  const [pickerX, pickerY] = pickedColor._coords;
  const movementKey = pickerX < global.stage.width - 1 ? Clutter.KEY_Right : Clutter.KEY_Left;
  pickedColor.vfunc_key_press_event({
    get_key_symbol: () => movementKey,
    get_state: () => 0,
  });
  await Scripting.sleep(100);
  assert(Math.abs(pickedColor._coords[0] - pickerX) === 1 && pickedColor._coords[1] === pickerY,
    'Color picker keyboard movement did not advance by one logical pixel');
  pickedColor._onPicked(pickedColor._rgb);
  pickedColor.close();
  await Scripting.sleep(300);
  assert(!extensionObject._colorPicker, 'Color picker did not release its modal overlay');
  assert(indicator._controller.items.some(item => item.text.startsWith('#')),
    'Picked color did not enter clipboard history');
  const colorItem = indicator._controller.items.find(item => item.text.startsWith('#'));
  const colorRow = history.entry(colorItem);
  const colorContentBody = colorRow.focusActors[0].get_child();
  const colorSwatch = colorContentBody.get_children().find(child =>
    child.has_style_class_name?.('cbx-color-swatch'));
  assert(colorSwatch?.get_style().includes('background-color: rgba(')
      && !colorSwatch.can_focus
      && !colorSwatch.reactive
      && !colorRow.get_children().some(child =>
        child.has_style_class_name?.('cbx-color-swatch')),
  'Color swatch was not grouped inside the clipboard content action');
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

  extensionObject._pickColor();
  await Scripting.sleep(300);
  assert(extensionObject._colorPicker, 'Color picker did not reopen for lifecycle testing');

  const oldController = extensionObject._controller;
  const oldSync = extensionObject._sync;
  Main.extensionManager.disableExtension(UUID);
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME], 'Indicator remained after disabling Clipboard X');
  assert(!extensionObject._colorPicker, 'Disabling Clipboard X did not close the active color picker');
  assert(oldController._destroyed && oldController._selectionSignal === 0
      && oldController._settingsSignals.length === 0,
  'Disabling Clipboard X did not release clipboard and settings subscriptions');
  assert(oldSync._destroyed && oldSync._pollSource === 0
      && oldSync._activeCancellables.size === 0 && oldSync._transferWaiters.size === 0,
  'Disabling Clipboard X did not release synchronization polling, requests or transfer waiters');
  assert(!extensionObject._shortcutBound, 'Disabling Clipboard X did not remove its shortcut');

  Main.extensionManager.enableExtension(UUID);
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X did not recover after being enabled again');
  assert(indicator._settings.get_string('device-id') === deviceId,
    'DeviceId changed after the extension was disabled and enabled again');
  assert(indicator._controller.items.some(item => item.favorite && item.text === colorItem.text),
    'Favorited clipboard history did not survive extension restart');

  Main.sessionMode.pushMode('unlock-dialog');
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME],
    'Clipboard X remained active after the session entered its lock mode');
  Main.sessionMode.popMode('unlock-dialog');
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X did not recover after the session left its lock mode');
  assert(indicator._settings.get_string('device-id') === deviceId,
    'DeviceId changed across the lock/unlock lifecycle');

  Gio.Subprocess.new([
    '/usr/bin/python3',
    GLib.build_filenamev([TEST_DIRECTORY, '..', 'fixtures', 'pause-process.py']),
    `${new Gio.Credentials().get_unix_pid()}`,
  ], Gio.SubprocessFlags.NONE);
  await Scripting.sleep(900);
  assert(Main.panel.statusArea[STATUS_AREA_NAME],
    'Clipboard X did not survive a nested Shell process suspend/resume cycle');
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'clipboard after simulated resume');
  await Scripting.sleep(400);
  assert(indicator._controller.items.some(item => item.text === 'clipboard after simulated resume'),
    'Clipboard capture did not recover after the simulated resume cycle');
}
