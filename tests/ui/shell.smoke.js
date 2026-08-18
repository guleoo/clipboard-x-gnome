import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

const UUID = 'clipboard-x@guleo.github.io';
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
  for (const item of indicator._controller.items)
    indicator._controller.remove(item.id);
  await Scripting.sleep(200);
  if (GLib.getenv('CLIPBOARD_X_EXPECT_CHINESE') === '1') {
    assert(indicator._search.hint_text === '搜索剪切板历史…',
      `Clipboard X translation was not loaded (${indicator._search.hint_text})`);
    if (GLib.getenv('CLIPBOARD_X_TRANSLATION_ONLY') === '1')
      return;
  }

  indicator.menu.open();
  await Scripting.sleep(200);
  assert(indicator.menu.isOpen, 'Clipboard X menu did not open');
  assert(indicator.menu.actor.width === indicator._settings.get_int('panel-width'),
    'Configured panel width was not enforced on the popup actor');
  assert(Number.isFinite(indicator._captureHistoryView().scrollValue),
    'Clipboard history view state could not read the GNOME 50 scroll adjustment');
  const originalTextOffset = indicator._settings.get_int('panel-text-vertical-offset');
  indicator._settings.set_int('panel-text-vertical-offset', -1);
  assert(indicator._search.clutter_text.translation_y === -1
      && indicator._search.get_hint_actor().translation_y === -1
      && indicator._tooltip.translation_y === -1,
  'Configured text vertical offset was not applied to input, placeholder and panel text');
  indicator._settings.set_int('panel-text-vertical-offset', originalTextOffset);
  assert([indicator._search, indicator._search.clutter_text].includes(global.stage.get_key_focus()),
    'Opening the panel must focus its keyboard-search entry');
  assert(indicator._toolbar.get_children().length === 3,
    'Top toolbar must contain only screenshot, color picker and privacy actions');
  assert(indicator._search.get_parent() === indicator._toolbar.get_parent(),
    'Search and the three primary tools must share one row');
  assert(indicator._privateButton.get_parent() === indicator._toolbar
      && indicator._syncToolButton.get_parent() === indicator._footer,
    'Privacy and synchronization buttons were not swapped');
  indicator._privateButton.grab_key_focus();
  indicator._showTooltip(indicator._privateButton, true);
  assert(indicator._tooltip.visible && indicator._tooltip.get_parent() === Main.uiGroup,
    'Icon help must use a floating Shell tooltip');
  indicator._handleStageCapturedEvent({type: () => Clutter.EventType.MOTION});
  assert(!indicator._tooltip.visible,
    'Moving the mouse did not dismiss a keyboard-triggered tooltip');
  const originalSearchShortcut = indicator._settings.get_strv('history-search-shortcut');
  indicator._settings.set_strv('history-search-shortcut', ['<Control>f']);
  assert(indicator._handleMenuKey({
    get_key_symbol: () => Clutter.KEY_f,
    get_state: () => Clutter.ModifierType.CONTROL_MASK,
  }) === Clutter.EVENT_STOP, 'Clipboard search shortcut was not consumed');
  assert([indicator._search, indicator._search.clutter_text].includes(global.stage.get_key_focus()),
    'Clipboard search shortcut did not focus the search entry');
  indicator._settings.set_strv('history-search-shortcut', originalSearchShortcut);
  const originalPanelConfineFocus = indicator._settings.get_boolean('panel-confine-focus');
  indicator._settings.set_boolean('panel-confine-focus', true);
  indicator._privateButton.grab_key_focus();
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
  assert(modifiersReleased, 'Terminal input did not resume after the triggering Ctrl key was released');
  terminalInput._modifierState = modifierState.bind(terminalInput);
  const manualInputCallback = terminalInput._onManualInput;
  let manualInputNotifications = 0;
  terminalInput._onManualInput = () => manualInputNotifications++;
  terminalInput._monitoring = true;
  const physicalKeyboard = {get_device_node: () => '/dev/input/event-test'};
  const keyboardEvent = (type, device) => ({
    type: () => type,
    get_source_device: () => device,
    get_key_code: () => 30,
  });
  terminalInput._filterEvent(keyboardEvent(
    Clutter.EventType.KEY_PRESS,
    {get_device_node: () => null},
  ));
  assert(manualInputNotifications === 0, 'Virtual keyboard event was mistaken for manual input');
  terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_PRESS, physicalKeyboard));
  terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_PRESS, physicalKeyboard));
  await Scripting.sleep(10);
  assert(manualInputNotifications === 1, 'Manual keyboard interruption did not emit one pause notification');
  terminalInput._filterEvent(keyboardEvent(Clutter.EventType.KEY_RELEASE, physicalKeyboard));
  terminalInput._monitoring = false;
  terminalInput._manualInputActive = false;
  terminalInput._activity.reset();
  terminalInput._onManualInput = manualInputCallback;

  indicator._settings.set_boolean('show-indicator', false);
  await Scripting.sleep(100);
  assert(!indicator.visible, 'Panel visibility setting did not apply immediately');
  indicator._settings.set_boolean('show-indicator', true);
  indicator._settings.set_strv('panel-shortcut', ['<Super>v']);
  await Scripting.sleep(100);
  assert(extensionObject._shortcutBound, 'User shortcut was not registered');

  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'Clipboard X smoke test 你好 👋');
  await Scripting.sleep(500);
  assert(indicator._controller.items.some(item => item.text.includes('smoke test')),
    'Clipboard X did not capture a text clipboard change');
  const capturedText = indicator._controller.items.find(item => item.text.includes('smoke test'));
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
  assert(indicator._handleEntryKey(capturedText, entryEvent(Clutter.KEY_v)) === Clutter.EVENT_STOP,
    'Clipboard entry paste shortcut was not consumed');
  assert(indicator._handleEntryKey(capturedText, entryEvent(Clutter.KEY_apostrophe)) === Clutter.EVENT_STOP,
    'Clipboard entry typing shortcut was not consumed');
  assert(indicator._handleEntryKey(
    capturedText,
    entryEvent(Clutter.KEY_Return, Clutter.ModifierType.CONTROL_MASK),
  ) === Clutter.EVENT_STOP, 'Ctrl+Enter did not invoke clipboard entry typing');
  await Scripting.sleep(10);
  assert(itemCommands.join(',') === `paste:${capturedText.id},type:${capturedText.id},type:${capturedText.id}`,
    'Clipboard entry keyboard commands invoked the wrong actions');
  indicator._settings.set_strv('history-paste-shortcut', ['x']);
  assert(indicator._handleEntryKey(capturedText, entryEvent(Clutter.KEY_v)) === Clutter.EVENT_PROPAGATE,
    'Reconfigured clipboard entry shortcut kept its old binding');
  assert(indicator._handleEntryKey(capturedText, entryEvent(Clutter.KEY_x)) === Clutter.EVENT_STOP,
    'Reconfigured clipboard entry shortcut did not use its new binding');
  await Scripting.sleep(10);
  assert(itemCommands.at(-1) === `paste:${capturedText.id}`,
    'Reconfigured clipboard entry shortcut invoked the wrong action');
  indicator._settings.set_strv('history-paste-shortcut', ['v']);
  indicator._actions.typeItem = originalTypeItem;
  indicator._actions.pasteItem = originalPasteItem;
  indicator._handleEntryKey(capturedText, entryEvent(Clutter.KEY_p));
  assert(capturedText.favorite, 'Clipboard entry p shortcut did not pin the entry');
  indicator._handleEntryKey(capturedText, entryEvent(Clutter.KEY_p));
  assert(!capturedText.favorite, 'Clipboard entry p shortcut did not unpin the entry');
  indicator._controller.toggleFavorite(capturedText.id);
  assert(capturedText.favorite, 'Clipboard history entry could not be favorited');
  const pinnedRow = indicator._entry(capturedText);
  assert(pinnedRow._clipboardXFocusRow.every(child => child._clipboardXHistoryRow === pinnedRow),
    'Clipboard history entry controls did not retain their focus matrix row');
  assert(pinnedRow.get_children().some(child => child instanceof St.Button
      && child.get_child()?.icon_name === 'view-pin-symbolic'
      && child.has_style_class_name('clipboard-x-pinned')),
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
  const tokenState = indicator._panelManager.state;
  assert(indicator._panelManager.is('tokenizer') && tokenState?.tokens.length > 1
      && !indicator._searchItem.visible
      && !indicator._historyScrollItem.actor.visible
      && !indicator._footerItem.visible
      && indicator._tokenPanelItem.visible,
    'Text segmentation did not switch the current panel to the token selection view');
  await Scripting.sleep(100);
  const tokenButtons = indicator._tokenBox.get_children()
    .flatMap(row => row.get_children());
  assert(tokenButtons.length === tokenState.tokens.length,
    'Text segmentation did not render one visible button for each token');
  assert(tokenButtons.every(button => button.mapped && button.width > 0 && button.height > 0),
    'Text segmentation rendered token buttons outside the visible layout');
  assert(global.stage.get_key_focus() === tokenButtons[0],
    'Opening the tokenizer did not focus the first token');
  assert(!indicator._tokenSource.visible,
    'Disabled source preview remained visible in the tokenizer');
  assert(tokenButtons.every(button => !button._clipboardXHintConnected),
    'Tokenizer buttons unexpectedly registered tooltip handlers');
  assert(indicator._handleTokenKey(
    tokenButtons[0],
    tokenState.tokens[0],
    tokenState,
    entryEvent(Clutter.KEY_Right),
  ) === Clutter.EVENT_PROPAGATE
      && indicator._handleMenuKey(entryEvent(Clutter.KEY_Right)) === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === tokenButtons[1],
  'Right Arrow did not move focus to the next token');
  const lastTokenButton = tokenButtons.at(-1);
  lastTokenButton.grab_key_focus();
  assert(indicator._handleTokenKey(
    lastTokenButton,
    lastTokenButton._clipboardXToken,
    tokenState,
    entryEvent(Clutter.KEY_Right),
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
  assert(indicator._tokenSource.visible,
    'Enabled source preview was not shown immediately');
  tokenButtons[0].grab_key_focus();
  indicator._handleTokenKey(
    tokenButtons[0],
    tokenState.tokens[0],
    tokenState,
    entryEvent(Clutter.KEY_Right, Clutter.ModifierType.SHIFT_MASK),
  );
  assert(tokenState.selected.has(tokenState.tokens[0].index)
      && tokenState.selected.has(tokenState.tokens[1].index)
      && global.stage.get_key_focus() === tokenButtons[1],
    'Shift+Arrow did not extend token selection and keyboard focus');
  tokenButtons[0].grab_key_focus();
  assert(indicator._handleTokenKey(
    tokenButtons[0],
    tokenState.tokens[0],
    tokenState,
    entryEvent(Clutter.KEY_Up),
  ) === Clutter.EVENT_PROPAGATE
      && indicator._handleMenuKey(entryEvent(Clutter.KEY_Up)) === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === indicator._tokenBack,
  'Up Arrow did not move from the first token to the tokenizer back button');
  lastTokenButton.grab_key_focus();
  assert(indicator._handleTokenKey(
    lastTokenButton,
    lastTokenButton._clipboardXToken,
    tokenState,
    entryEvent(Clutter.KEY_Down),
  ) === Clutter.EVENT_PROPAGATE
      && indicator._handleMenuKey(entryEvent(Clutter.KEY_Down)) === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === indicator._tokenCopy,
  'Down Arrow did not move from the final token to the copy button');
  assert(indicator._handleMenuKey(entryEvent(Clutter.KEY_Down)) === Clutter.EVENT_STOP
      && global.stage.get_key_focus() === indicator._tokenCopy,
  'Tokenizer copy button did not stop at the focus matrix boundary');
  tokenState.keyboardSelection = null;
  tokenButtons[0].grab_key_focus();
  indicator._handleTokenKey(
    tokenButtons[0],
    tokenState.tokens[0],
    tokenState,
    entryEvent(Clutter.KEY_Right, Clutter.ModifierType.SHIFT_MASK),
  );
  assert(!tokenState.selected.has(tokenState.tokens[0].index)
      && !tokenState.selected.has(tokenState.tokens[1].index),
  'Shift+Arrow did not deselect a range anchored on a selected token');
  for (const button of tokenButtons) {
    const token = button._clipboardXToken;
    indicator._setTokenSelected(button, token, tokenState, false, false);
  }
  tokenState.keyboardSelection = null;
  indicator._updateTokenResult();
  indicator._beginTokenSelectionDrag(tokenButtons[0], tokenState.tokens[0], tokenState);
  const [secondTokenX, secondTokenY] = tokenButtons[1].get_transformed_position();
  const [secondTokenWidth, secondTokenHeight] = tokenButtons[1].get_transformed_size();
  indicator._applyTokenSelectionAt(
    secondTokenX + secondTokenWidth / 2,
    secondTokenY + secondTokenHeight / 2,
  );
  indicator._endTokenSelectionDrag();
  assert(tokenState.selected.has(tokenState.tokens[0].index)
      && tokenState.selected.has(tokenState.tokens[1].index)
      && tokenButtons[0].checked && tokenButtons[1].checked,
    'Press-and-drag token selection did not select every visited token');
  indicator._setTokenSelected(tokenButtons[1], tokenState.tokens[1], tokenState, false);
  assert(indicator._tokenResult.text === tokenState.tokens[0].text,
    'Selected token did not update the copy result preview');
  assert(indicator._tokenResult.get_parent().get_parent() === indicator._tokenPanel,
    'Selected-token preview is not fixed outside the scrolling token area');
  indicator._settings.set_boolean('tokenizer-show-source-preview', originalSourcePreview);
  indicator._settings.set_boolean('panel-confine-focus', originalConfineFocus);
  indicator._closeTokenizer();
  assert(indicator._panelManager.is('history')
      && indicator._searchItem.visible
      && indicator._historyScrollItem.actor.visible
      && indicator._footerItem.visible
      && !indicator._tokenPanelItem.visible,
    'Returning from text segmentation did not restore clipboard history');
  indicator.menu.close();
  const originalTimestamp = capturedText.createdAt;
  await indicator._controller.activate(capturedText);
  await Scripting.sleep(300);
  assert(capturedText.createdAt === originalTimestamp,
    'Programmatic clipboard activation was captured again instead of being loop-suppressed');

  indicator._settings.set_boolean('private-mode', true);
  assert(indicator._privateButton.checked
      && indicator._privateButton.has_style_class_name('clipboard-x-private-active'),
  'Privacy mode button did not expose its selected visual state');
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'private clipboard value must not be recorded');
  await Scripting.sleep(300);
  assert(!indicator._controller.items.some(item => item.text.includes('private clipboard value')),
    'Private mode did not pause clipboard capture');
  indicator._settings.set_boolean('private-mode', false);
  assert(!indicator._privateButton.checked
      && indicator._privateButton.has_style_class_name('clipboard-x-private-inactive'),
  'Privacy mode button did not return to its inactive visual state');

  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'disposable clipboard history entry');
  await Scripting.sleep(300);
  const disposable = indicator._controller.items.find(item => item.text === 'disposable clipboard history entry');
  assert(disposable, 'Disposable history fixture was not captured');
  indicator._handleEntryKey(disposable, entryEvent(Clutter.KEY_Delete));
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
  indicator._settings.set_string('editor-app-id', '');
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
  const imageRow = indicator._entry(imageItem);
  assert(imageRow.get_children().filter(child => child instanceof St.Button).length === 5,
    'Image history row must expose content, edit, pin, synchronization and delete actions');
  imageRow.destroy();
  imageItem.remote = true;
  imageItem.availability = 'preview';
  const remoteButton = indicator._syncButton(imageItem);
  assert(remoteButton.get_child().icon_name === 'folder-download-symbolic',
    'Remote image preview did not expose its lazy download action');
  imageItem.availability = 'failed';
  indicator._updateSyncButton(imageItem, remoteButton);
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
  const progressButton = indicator._syncButton(imageItem);
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
  assert(automaticPublishes === 1, 'Automatic policy sent sensitive content without permission');
  imageItem.sensitive = false;
  imageItem.favorite = false;
  extensionObject._publish = publish;
  indicator._settings.set_boolean('sync-favorites-only', false);
  indicator._settings.set_string('sync-send-mode', 'manual');
  indicator._settings.set_boolean('sync-enabled', false);
  const syncDisabledRow = indicator._entry(imageItem);
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
  indicator._settings.set_string('screenshot-target', 'screen');
  indicator._settings.set_boolean('screenshot-add-history', true);
  indicator._settings.set_boolean('screenshot-write-clipboard', true);
  indicator._settings.set_boolean('screenshot-open-editor', true);
  await extensionObject._takeScreenshot();
  await Scripting.sleep(300);
  const screenshotItem = indicator._controller.items.find(item => item.isImage);
  assert(screenshotItem?.primary.path,
    'Screenshot pipeline did not add and persist the image history snapshot');
  assert(indicator._controller._selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD).includes('image/png'),
    'Screenshot pipeline did not write the image to the clipboard');

  indicator._settings.set_boolean('screenshot-add-history', false);
  indicator._settings.set_boolean('screenshot-open-editor', false);
  const historyCount = indicator._controller.items.length;
  await extensionObject._takeScreenshot();
  await Scripting.sleep(300);
  assert(indicator._controller.items.length === historyCount,
    'Screenshot configured without history was captured again through clipboard owner change');
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
  assert(oldSync._destroyed && oldSync._nameWatchId === 0 && oldSync._connectIdleId === 0
      && oldSync._transferWaiters.size === 0,
  'Disabling Clipboard X did not release D-Bus watches, idle sources or transfer waiters');
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
