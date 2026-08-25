import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ProgressRing} from './progress-ring.js';

const ICON_SIZE = 16;
const TERMINAL_TRANSFER_STATES = new Set(['completed', 'failed', 'cancelled', 'expired']);

export class SyncAction {
  constructor({settings, actions, tooltip, createIconButton, closeMenu}) {
    this._settings = settings;
    this._actions = actions;
    this._tooltip = tooltip;
    this._createIconButton = createIconButton;
    this._closeMenu = closeMenu;
    this._transfers = new Map();
    this._buttons = new Map();
    this.statusButton = createIconButton(
      'network-offline-symbolic',
      _('Synchronization settings'),
      () => this._runAndClose(() => actions.openPreferences()),
    );
  }

  button(item) {
    const button = this._createIconButton(
      'folder-remote-symbolic',
      _('Synchronize'),
      () => this._activate(item),
      {showTooltip: false},
    );
    button._clipboardItem = item;
    this._buttons.set(item.id, button);
    this._update(item, button);
    return button;
  }

  clearButtons() {
    this._buttons.clear();
  }

  setStatus(status, capabilities = null) {
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
      text = capabilities?.error ?? _('Sync protocol error');
    } else {
      iconName = 'network-transmit-receive-symbolic';
      const implementation = capabilities?.implementationName;
      text = implementation ? `${implementation} · ${status}` : _('Synchronization server online');
    }
    this._setIcon(this.statusButton, iconName);
    this._setHint(this.statusButton, text);
  }

  setTransfer(transfer) {
    this._transfers.set(transfer.itemId, {...transfer});
    const button = this._buttons.get(transfer.itemId);
    if (button)
      this._update(button._clipboardItem, button);
  }

  destroy() {
    this._buttons.clear();
    this._transfers.clear();
  }

  _update(item, button) {
    const transfer = this._transfers.get(item.id);
    if (transfer && !TERMINAL_TRANSFER_STATES.has(transfer.state)) {
      if (transfer.totalBytes > 0) {
        button.set_child(new ProgressRing(transfer.completedBytes / transfer.totalBytes));
        this._setHint(button, `${transfer.direction === 'upload' ? _('Uploading') : _('Downloading')} · ${Math.round(transfer.completedBytes / transfer.totalBytes * 100)}%`);
      } else {
        this._setIcon(button, 'content-loading-symbolic');
        this._setHint(button, transfer.state === 'waiting-for-peer'
          ? _('Waiting for peer device')
          : _('Preparing transfer'));
      }
      return;
    }
    if (transfer?.state === 'failed' || transfer?.state === 'expired') {
      this._setIcon(button, 'view-refresh-symbolic');
      this._setHint(button, transfer.errorMessage || _('Transfer failed; activate to retry'));
      return;
    }
    if (transfer?.state === 'completed') {
      this._setIcon(button, 'emblem-ok-symbolic');
      this._setHint(button, transfer.direction === 'upload'
        ? _('Upload completed')
        : _('Original downloaded'));
      return;
    }
    if (!this._settings.get_boolean('sync-enabled')) {
      this._setIcon(button, 'network-offline-symbolic');
      this._setHint(button, _('Synchronization is disabled'));
      return;
    }
    if (item.remote && item.availability !== 'ready') {
      const failed = item.availability === 'failed';
      this._setIcon(button, failed ? 'view-refresh-symbolic' : 'folder-download-symbolic');
      this._setHint(button, failed ? _('Retry original download') : _('Download original'));
      return;
    }
    this._setIcon(button, 'folder-remote-symbolic');
    this._setHint(button, item.remote
      ? _('Original is available locally')
      : _('Send to synchronization server'));
  }

  async _activate(item) {
    const transfer = this._transfers.get(item.id);
    if (transfer && !TERMINAL_TRANSFER_STATES.has(transfer.state)) {
      await this._actions.cancelTransfer(transfer.transferId);
      return;
    }
    if (!this._settings.get_boolean('sync-enabled')) {
      this._runAndClose(() => this._actions.openPreferences());
      return;
    }
    if (item.remote && item.availability !== 'ready')
      await this._actions.materializeItem(item);
    else if (!item.remote)
      await this._actions.publish(item);
  }

  _setIcon(button, iconName) {
    if (button.setIcon) {
      button.setIcon(iconName);
      return;
    }
    button.set_child(new St.Icon({
      icon_name: iconName,
      icon_size: button._clipboardXIconSize ?? ICON_SIZE,
    }));
  }

  _setHint(actor, text) {
    if (actor.setHint)
      actor.setHint(text);
    else {
      actor.accessible_name = text;
      actor._hintText = text;
    }
    if (actor._clipboardXShowTooltip)
      this._tooltip.attach(actor, text, {scope: actor._clipboardXTooltipScope});
  }

  _runAndClose(callback) {
    this._closeMenu();
    return callback();
  }
}
