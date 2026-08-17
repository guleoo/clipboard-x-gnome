import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ClipboardController} from '../clipboard/controller.js';
import {formatColor} from '../color-picker/color.js';
import {ColorPicker} from '../color-picker/picker.js';
import {launchEditor} from '../screenshot/editor-launcher.js';
import {SyncClient} from '../sync/client.js';
import {ensureDeviceIdentity} from '../sync/device.js';
import {Indicator} from '../ui/indicator.js';
import {ScreenshotPortal} from '../screenshot/portal.js';

const SHORTCUT_KEYS = Object.freeze([
  'panel-shortcut',
  'screenshot-shortcut',
  'color-picker-shortcut',
  'private-mode-shortcut',
  'clear-history-shortcut',
]);

export default class ClipboardXExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._controller = new ClipboardController(this._settings);
    this._portal = new ScreenshotPortal();
    this._sync = new SyncClient(this._settings);
    this._colorPicker = null;
    this._settingsSignals = [];
    this._boundShortcuts = [];

    const actions = {
      extensionObject: this,
      ensureIdentity: () => ensureDeviceIdentity(this._settings),
      screenshot: () => this._takeScreenshot(),
      pickColor: () => this._pickColor(),
      editItem: item => this._editItem(item),
      activateItem: item => this._activateItem(item),
      materializeItem: item => this._ensureMaterialized(item),
      publish: item => this._publish(item),
      cancelTransfer: transferId => this._sync.cancelTransfer(transferId),
      copyText: text => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text),
      openPreferences: () => this.openPreferences(),
      reportError: error => this._reportError(error),
    };
    this._indicator = new Indicator(this._settings, this._controller, actions);
    Main.panel.addToStatusArea('clipboard-x', this._indicator, 1);

    this._settingsSignals.push(
      this._settings.connect('changed::show-indicator', () => this._updateIndicatorVisibility()),
      ...SHORTCUT_KEYS.map(key => this._settings.connect(`changed::${key}`, () => this._bindShortcuts())),
      this._settings.connect('changed::sync-enabled', () => this._sync.restart().catch(error => this._reportError(error))),
    );
    this._updateIndicatorVisibility();
    this._bindShortcuts();

    this._itemAddedSignal = this._controller.connect('item-added', (_controller, item, source) => {
      if (source !== 'remote')
        this._publishAutomatically(item);
    });
    this._favoriteSignal = this._controller.connect('favorite-changed', (_controller, item, favorite) => {
      if (favorite && this._settings.get_boolean('sync-favorites-only'))
        this._publishAutomatically(item);
    });

    this._syncItemSignal = this._sync.connect('item-available', (_sync, itemId) => {
      this._receiveRemoteItem(itemId).catch(error => this._reportError(error));
    });
    this._syncRemovedSignal = this._sync.connect('item-removed', (_sync, itemId) => {
      this._controller.remove(itemId);
    });
    this._syncStatusSignal = this._sync.connect('status-changed', (_sync, status, capabilities) => {
      this._indicator?.setSyncStatus(status, capabilities);
    });
    this._transferSignal = this._sync.connect(
      'transfer-changed',
      (_sync, transfer) => {
        this._indicator?.setTransfer(transfer);
      },
    );

    this._controller.start().catch(error => this._reportError(error));
    this._indicator.setSyncStatus('offline');
    this._sync.start().catch(error => this._reportError(error));
  }

  disable() {
    this._unbindShortcuts();
    this._portal?.cancel();
    this._colorPicker?.close();
    this._colorPicker = null;

    if (this._itemAddedSignal)
      this._controller.disconnect(this._itemAddedSignal);
    if (this._syncItemSignal)
      this._sync.disconnect(this._syncItemSignal);
    if (this._favoriteSignal)
      this._controller.disconnect(this._favoriteSignal);
    if (this._syncRemovedSignal)
      this._sync.disconnect(this._syncRemovedSignal);
    if (this._syncStatusSignal)
      this._sync.disconnect(this._syncStatusSignal);
    if (this._transferSignal)
      this._sync.disconnect(this._transferSignal);
    this._itemAddedSignal = 0;
    this._syncItemSignal = 0;
    this._favoriteSignal = 0;
    this._syncRemovedSignal = 0;
    this._syncStatusSignal = 0;
    this._transferSignal = 0;

    for (const signal of this._settingsSignals)
      this._settings.disconnect(signal);
    this._settingsSignals = [];

    this._indicator?.destroy();
    this._sync?.destroy();
    this._controller?.destroy();
    this._indicator = null;
    this._sync = null;
    this._controller = null;
    this._portal = null;
    this._settings = null;
  }

  async _publish(item) {
    if (!this._settings.get_boolean('sync-enabled'))
      throw new Error('Synchronization is disabled');
    await this._controller.persist();
    return this._sync.publish(item);
  }

  _publishAutomatically(item) {
    if (!this._settings.get_boolean('sync-enabled')
        || this._settings.get_string('sync-send-mode') !== 'automatic'
        || (item.sensitive && !this._settings.get_boolean('sync-sensitive'))
        || (this._settings.get_boolean('sync-favorites-only') && !item.favorite))
      return;
    this._publish(item).catch(error => this._reportError(error));
  }

  async _takeScreenshot() {
    const uri = await this._portal.capture(this._settings.get_string('screenshot-target'));
    const item = this._settings.get_boolean('screenshot-add-history')
      ? await this._controller.addFromUri(uri, 'screenshot')
      : await this._controller.createFromUri(uri);
    if (this._settings.get_boolean('screenshot-write-clipboard'))
      await this._controller.writeScreenshot(item);
    if (this._settings.get_boolean('screenshot-open-editor'))
      await this._launchEditor(uri);
  }

  _pickColor() {
    if (this._colorPicker)
      return;
    this._colorPicker = new ColorPicker(rgb => {
      const text = formatColor(rgb, this._settings.get_string('color-format'));
      St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
      this._colorPicker = null;
    }, this._settings.get_string('color-format'));
    this._colorPicker.connect('destroy', () => {
      this._colorPicker = null;
    });
  }

  async _editItem(item) {
    await this._ensureMaterialized(item);
    await this._controller.persist();
    const path = item.primary?.path;
    if (!path)
      throw new Error('The original image is not available locally');
    await this._launchEditor(Gio.File.new_for_path(path).get_uri());
  }

  async _activateItem(item) {
    await this._ensureMaterialized(item);
    await this._controller.activate(item);
  }

  async _ensureMaterialized(item) {
    const requiresRemoteContent = item.remote
      && item.representations.some(representation => !representation.bytes && !representation.path);
    if (requiresRemoteContent) {
      try {
        await this._sync.materialize(item);
        this._controller.update(item);
        await this._controller.persist();
        await this._sync.acknowledge(item.id, 'accepted');
      } catch (error) {
        this._controller.update(item);
        try {
          await this._sync.acknowledge(item.id, 'rejected');
        } catch (_acknowledgeError) {
          // Preserve the materialization error when the Service is also unavailable.
        }
        throw error;
      }
    } else {
      await this._controller.materialize(item);
    }
    return item;
  }

  async _receiveRemoteItem(itemId) {
    if (this._settings.get_string('sync-receive-mode') === 'disabled')
      return;
    const item = await this._sync.getItem(itemId);
    if (item.originDeviceId === ensureDeviceIdentity(this._settings).deviceId)
      return;
    this._controller.add(item, 'remote');
    if (this._settings.get_string('sync-receive-mode') === 'activate')
      await this._activateItem(item);
  }

  _launchEditor(uri) {
    return launchEditor({
      appId: this._settings.get_string('editor-app-id'),
      command: this._settings.get_string('editor-command'),
      uri,
      launchContext: global.create_app_launch_context(0, -1),
    });
  }

  _updateIndicatorVisibility() {
    this._indicator.visible = this._settings.get_boolean('show-indicator');
  }

  _bindShortcuts() {
    this._unbindShortcuts();
    const actions = {
      'panel-shortcut': () => {
        ensureDeviceIdentity(this._settings);
        this._indicator.menu.toggle();
      },
      'screenshot-shortcut': () => this._takeScreenshot().catch(error => this._reportError(error)),
      'color-picker-shortcut': () => this._pickColor(),
      'private-mode-shortcut': () => {
        this._settings.set_boolean('private-mode', !this._settings.get_boolean('private-mode'));
      },
      'clear-history-shortcut': () => this._controller.clear(),
    };
    for (const key of SHORTCUT_KEYS) {
      if (!(this._settings.get_strv(key)[0] ?? ''))
        continue;
      try {
        Main.wm.addKeybinding(
          key,
          this._settings,
          Meta.KeyBindingFlags.NONE,
          Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
          actions[key],
        );
        this._boundShortcuts.push(key);
      } catch (_error) {
        console.error(`Clipboard X: invalid ${key} was ignored`);
      }
    }
    this._shortcutBound = this._boundShortcuts.length > 0;
  }

  _unbindShortcuts() {
    for (const key of this._boundShortcuts ?? [])
      Main.wm.removeKeybinding(key);
    this._boundShortcuts = [];
    this._shortcutBound = false;
  }

  _reportError(error) {
    if (error?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
      return;
    console.error('Clipboard X: operation failed; details were shown in the desktop notification');
    Main.notifyError('Clipboard X', error?.message ?? String(error));
  }
}
