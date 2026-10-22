import Gio from 'gi://Gio';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {message as syncErrorMessage} from '../../../sync/errors.js';
import {ProgressRing} from './progress-ring.js';
import {isComplete, isPreviewPublished} from './sync-state.js';

const TERMINAL_TRANSFER_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);

export class SyncAction {
  constructor({settings, actions, createIconButton, closeMenu}) {
    this._previewIcon = new Gio.FileIcon({
      file: Gio.File.new_for_uri(import.meta.url).get_parent()
        .resolve_relative_path('../../icons/sync/preview-synced-symbolic.svg'),
    });
    this._settings = settings;
    this._actions = actions;
    this._createIconButton = createIconButton;
    this._closeMenu = closeMenu;
    this._buttons = new Map();
    this._status = 'offline';
    this._capabilities = null;
    this._accentColor = null;
    this.statusButton = createIconButton(
      'network-offline-symbolic',
      _('Synchronization'),
      () => settings.set_boolean('sync-enabled', !settings.get_boolean('sync-enabled')),
      {stateful: true},
    );
    this._enabledSignal = settings.connect('changed::sync-enabled', () => this._updateStatus());
    this._updateStatus();
  }

  button(item) {
    const button = this._createIconButton(
      'network-transmit-receive-symbolic',
      _('Synchronize'),
      () => this._activate(item),
      {showTooltip: false},
    );
    button._clipboardItem = item;
    this._buttons.set(item.id, button);
    button.connect('destroy', () => {
      if (this._buttons.get(item.id) === button)
        this._buttons.delete(item.id);
    });
    this._update(item, button);
    return button;
  }

  clearButtons() {
    this._buttons.clear();
  }

  setStatus(status, capabilities = null) {
    this._status = status;
    this._capabilities = capabilities;
    this._updateStatus();
    for (const button of this._buttons.values())
      this._update(button._clipboardItem, button);
  }

  setAccent(color) {
    this._accentColor = color;
    this._updateSelected();
  }

  _updateSelected() {
    const enabled = this._settings.get_boolean('sync-enabled');
    this.statusButton.selected = enabled;
    this.statusButton.set_style(enabled && this._accentColor
      ? `color: ${this._accentColor};` : '');
  }

  _updateStatus() {
    const status = this._status;
    const capabilities = this._capabilities;
    let iconName;
    let text;
    if (!this._settings.get_boolean('sync-enabled')) {
      iconName = 'network-offline-symbolic';
      text = _('Sync disabled');
    } else if (status === 'offline') {
      iconName = 'network-offline-symbolic';
      text = _('Synchronization server offline');
    } else if (status === 'error') {
      iconName = 'dialog-error-symbolic';
      text = syncErrorMessage({
        code: capabilities?.errorCode,
        message: capabilities?.error,
      }, _) || _('Sync protocol error');
    } else {
      iconName = 'network-transmit-receive-symbolic';
      const implementation = capabilities?.implementationName;
      const state = status === 'degraded'
        ? _('Synchronization server degraded')
        : _('Synchronization server online');
      text = implementation ? `${implementation} · ${state}` : state;
    }
    this.statusButton.setIcon(iconName);
    this.statusButton.setHint(text);
    this._updateSelected();
  }

  refresh(itemId) {
    const button = this._buttons.get(itemId);
    if (button)
      this._update(button._clipboardItem, button);
  }

  destroy() {
    this._settings.disconnect(this._enabledSignal);
    this._buttons.clear();
    this._previewIcon = null;
  }

  _update(item, button) {
    const transfer = this._actions.transferForItem(item.id);
    if (isComplete(item, transfer)) {
      if (isPreviewPublished(item, transfer)) {
        button.setIcon(this._previewIcon);
      } else {
        button.setIcon('object-select-symbolic');
      }
      button.setHint(item.remote
        ? _('Original is available locally')
        : transfer.direction === 'upload' ? _('Upload completed') : _('Original downloaded'));
      return;
    }
    if (transfer && !TERMINAL_TRANSFER_STATES.has(transfer.state)) {
      if (transfer.totalBytes > 0) {
        button.set_child(new ProgressRing(transfer.completedBytes / transfer.totalBytes));
        button.setHint(`${transfer.direction === 'upload' ? _('Uploading') : _('Downloading')} · ${Math.round(transfer.completedBytes / transfer.totalBytes * 100)}%`);
      } else {
        button.setIcon('content-loading-symbolic');
        button.setHint(transfer.state === 'waiting-for-peer'
          ? _('Waiting for peer device')
          : _('Preparing transfer'));
      }
      return;
    }
    if (transfer?.state === 'failed' || transfer?.state === 'expired') {
      button.setIcon('view-refresh-symbolic');
      button.setHint(
        syncErrorMessage({code: transfer.errorCode, message: transfer.errorMessage}, _)
          || _('Transfer failed; activate to retry'),
      );
      return;
    }
    if (!this._settings.get_boolean('sync-enabled')) {
      button.setIcon('network-offline-symbolic');
      button.setHint(_('Synchronization is disabled'));
      return;
    }
    if (item.remote) {
      const failed = item.availability === 'failed';
      button.setIcon(failed ? 'view-refresh-symbolic' : 'folder-download-symbolic');
      button.setHint(failed ? _('Retry original download') : _('Download original'));
      return;
    }
    button.setIcon('network-transmit-receive-symbolic');
    button.setHint(item.remote
      ? _('Original is available locally')
      : _('Send to synchronization server'));
  }

  async _activate(item) {
    const transfer = this._actions.transferForItem(item.id);
    if (transfer && !TERMINAL_TRANSFER_STATES.has(transfer.state)) {
      await this._actions.cancelTransfer(transfer.transferId);
      return;
    }
    if (!this._settings.get_boolean('sync-enabled')) {
      this._runAndClose(() => this._actions.openPreferences());
      return;
    }
    if (item.remote && !isComplete(item))
      await this._actions.materializeItem(item);
    else if (!item.remote)
      await this._actions.publish(item);
  }

  _runAndClose(callback) {
    this._closeMenu();
    return callback();
  }
}
