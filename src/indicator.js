import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {processText} from './text-processors.js';

const PANEL_ITEM_LIMIT = 200;
const TEXT_PROCESSING_LIMIT_BYTES = 1024 * 1024;

export const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
  _init(settings, controller, actions) {
    super._init(0.0, 'Clipboard X');
    this._settings = settings;
    this._controller = controller;
    this._actions = actions;
    this._query = '';

    this.add_child(new St.Icon({
      icon_name: 'edit-paste-symbolic',
      style_class: 'system-status-icon',
    }));
    this.menu.actor.add_style_class_name('clipboard-x-menu');
    this._buildMenu();

    this._changedSignal = controller.connect('changed', () => this._refresh());
    this.menu.connect('open-state-changed', (_menu, open) => {
      if (open) {
        this._actions.ensureIdentity();
        this._search.set_text('');
        global.stage.set_key_focus(this._search);
      }
    });
    this._refresh();
  }

  _buildMenu() {
    const searchItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this._search = new St.Entry({
      style_class: 'search-entry',
      hint_text: _('Search clipboard history…'),
      can_focus: true,
      x_expand: true,
      primary_icon: new St.Icon({icon_name: 'edit-find-symbolic'}),
    });
    this._search.clutter_text.connect('text-changed', () => {
      this._query = this._search.get_text();
      this._refresh();
    });
    searchItem.add_child(this._search);
    this.menu.addMenuItem(searchItem);

    const toolbarItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const toolbar = new St.BoxLayout({style_class: 'clipboard-x-toolbar'});
    toolbar.add_child(this._toolButton('camera-photo-symbolic', _('Screenshot'), () => this._actions.screenshot()));
    toolbar.add_child(this._toolButton('color-select-symbolic', _('Pick color'), () => this._actions.pickColor()));
    toolbar.add_child(this._toolButton('changes-prevent-symbolic', _('Private mode'), () => {
      this._settings.set_boolean('private-mode', !this._settings.get_boolean('private-mode'));
    }));
    toolbar.add_child(this._toolButton('user-trash-symbolic', _('Clear history'), () => this._controller.clear()));
    toolbar.add_child(this._toolButton('emblem-system-symbolic', _('Preferences'), () => this._actions.openPreferences()));
    toolbarItem.add_child(toolbar);
    this.menu.addMenuItem(toolbarItem);

    this._syncRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    this._syncIcon = new St.Icon({icon_name: 'network-offline-symbolic', style_class: 'popup-menu-icon'});
    this._syncLabel = new St.Label({text: _('Sync disabled'), x_expand: true});
    this._syncCancel = this._inlineButton('process-stop-symbolic', _('Cancel transfer'), () => {
      if (this._activeTransferId)
        return this._actions.cancelTransfer(this._activeTransferId);
      return null;
    });
    this._syncCancel.visible = false;
    this._syncRow.add_child(this._syncIcon);
    this._syncRow.add_child(this._syncLabel);
    this._syncRow.add_child(this._syncCancel);
    this.menu.addMenuItem(this._syncRow);
    this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    this._history = new PopupMenu.PopupMenuSection();
    this._scroll = new St.ScrollView({
      overlay_scrollbars: true,
      style_class: 'clipboard-x-history',
    });
    this._scroll.add_child(this._history.actor);
    const scrollItem = new PopupMenu.PopupMenuSection();
    scrollItem.actor.add_child(this._scroll);
    this.menu.addMenuItem(scrollItem);
  }

  setSyncStatus(status, capabilities = null) {
    if (!this._settings.get_boolean('sync-enabled')) {
      this._syncIcon.icon_name = 'network-offline-symbolic';
      this._syncLabel.text = _('Sync disabled');
      return;
    }
    if (status === 'offline') {
      this._syncIcon.icon_name = 'network-offline-symbolic';
      this._syncLabel.text = _('Sync Service offline');
    } else if (status === 'error') {
      this._syncIcon.icon_name = 'dialog-error-symbolic';
      this._syncLabel.text = capabilities?.error ?? _('Sync protocol error');
    } else {
      this._syncIcon.icon_name = 'network-transmit-receive-symbolic';
      const implementation = capabilities?.implementationName;
      this._syncLabel.text = implementation
        ? `${implementation} · ${status}`
        : _('Sync Service online');
    }
  }

  setTransfer(transferId, state, received, total, error) {
    const terminal = ['ready', 'cancelled', 'expired', 'failed'].includes(state);
    this._activeTransferId = terminal ? null : transferId;
    this._syncCancel.visible = !terminal;
    if (state === 'failed') {
      this._syncIcon.icon_name = 'dialog-error-symbolic';
      this._syncLabel.text = error || _('Transfer failed');
    } else if (state === 'ready') {
      this._syncLabel.text = _('Synchronized content is ready');
    } else if (state === 'waiting-for-source') {
      this._syncLabel.text = _('Waiting for the source device…');
    } else if (total > 0) {
      this._syncLabel.text = `${state} · ${Math.round(received / total * 100)}%`;
    } else {
      this._syncLabel.text = state;
    }
  }

  _toolButton(iconName, accessibleName, callback) {
    const button = new St.Button({
      can_focus: true,
      style_class: 'button clipboard-x-toolbar-button',
      accessible_name: accessibleName,
      child: new St.Icon({icon_name: iconName}),
    });
    button.connect('clicked', () => {
      this.menu.close();
      Promise.resolve(callback()).catch(error => this._actions.reportError(error));
    });
    return button;
  }

  _refresh() {
    this._history.removeAll();
    if (this._controller.loading) {
      this._addState(_('Loading clipboard history…'), 'content-loading-symbolic');
      return;
    }
    if (this._controller.error && this._controller.items.length === 0) {
      this._addState(_('Clipboard history could not be loaded'), 'dialog-error-symbolic');
      return;
    }
    const items = this._controller.search(this._query, PANEL_ITEM_LIMIT + 1);
    if (items.length === 0) {
      const empty = new PopupMenu.PopupBaseMenuItem({reactive: false});
      empty.add_child(new St.Label({
        text: this._query ? _('No matching entries') : _('Clipboard history is empty'),
        style_class: 'clipboard-x-empty',
      }));
      this._history.addMenuItem(empty);
      return;
    }

    for (const item of items.slice(0, PANEL_ITEM_LIMIT))
      this._history.addMenuItem(item.isText ? this._textItem(item) : this._imageItem(item));
    if (items.length > PANEL_ITEM_LIMIT) {
      this._history.addMenuItem(new PopupMenu.PopupMenuItem(
        _('Only the first 200 entries are shown; refine the search to see others'),
        {reactive: false},
      ));
    }
  }

  _addState(text, iconName) {
    const state = new PopupMenu.PopupBaseMenuItem({reactive: false});
    state.add_child(new St.Icon({icon_name: iconName, style_class: 'popup-menu-icon'}));
    state.add_child(new St.Label({text, style_class: 'clipboard-x-empty'}));
    this._history.addMenuItem(state);
  }

  _textItem(item) {
    const title = item.preview?.text?.replaceAll('\n', ' ') || _('Text');
    const source = item.originDeviceTag ? `${item.originDeviceTag} · ` : '';
    const row = new PopupMenu.PopupSubMenuMenuItem(`${source}${title}`.slice(0, 120));
    row.add_style_class_name('clipboard-x-entry');
    row.menu.addAction(_('Copy original'), () => this._activate(item));

    const processors = [
      ['words', _('Words')],
      ['sentences', _('Sentences')],
      ['lines', _('Lines')],
      ['separators', _('Separators')],
      ['urls', _('URLs')],
      ['emails', _('Email addresses')],
      ['numbers', _('Numbers')],
      ['identifiers', _('Identifier parts')],
    ];
    for (const [processor, label] of processors)
      row.menu.addMenuItem(this._processorItem(item, processor, label));
    this._addCommonActions(row.menu, item);
    return row;
  }

  _processorItem(item, processor, label) {
    const submenu = new PopupMenu.PopupSubMenuMenuItem(label);
    let loaded = false;
    submenu.menu.connect('open-state-changed', async (_menu, open) => {
      if (!open || loaded)
        return;
      loaded = true;
      submenu.menu.removeAll();
      try {
        if ((item.primary?.size ?? 0) > TEXT_PROCESSING_LIMIT_BYTES)
          throw new Error(_('This text is too large for interactive processing'));
        await this._actions.materializeItem(item);
        const values = processText(processor, item.text);
        if (values.length === 0) {
          const empty = new PopupMenu.PopupMenuItem(_('No results'), {reactive: false});
          submenu.menu.addMenuItem(empty);
          return;
        }

        submenu.menu.addAction(_('Copy all results'), () => this._actions.copyText(values.join('\n')));
        submenu.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const value of values.slice(0, 100)) {
          const title = value.replaceAll('\n', ' ').slice(0, 100);
          submenu.menu.addAction(title, () => this._actions.copyText(value));
        }
        if (values.length > 100) {
          submenu.menu.addMenuItem(new PopupMenu.PopupMenuItem(
            _('Only the first 100 results are shown'),
            {reactive: false},
          ));
        }
      } catch (error) {
        loaded = false;
        this._actions.reportError(error);
      }
    });
    return submenu;
  }

  _imageItem(item) {
    const row = new PopupMenu.PopupBaseMenuItem();
    row.add_style_class_name('clipboard-x-entry');
    const icon = item.preview?.path
      ? new St.Icon({gicon: Gio.icon_new_for_string(item.preview.path), icon_size: 54})
      : new St.Icon({icon_name: 'image-x-generic-symbolic', icon_size: 32});
    row.add_child(icon);
    const size = item.primary?.size ?? 0;
    row.add_child(new St.Label({
      text: `${item.originDeviceTag ? `${item.originDeviceTag} · ` : ''}${item.primary?.mimeType ?? _('Image')} · ${formatBytes(size)}`,
      x_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    }));
    row.connect('activate', () => this._activate(item));
    row.add_child(this._inlineButton('document-edit-symbolic', _('Edit'), () => this._actions.editItem(item)));
    row.add_child(this._inlineButton(
      item.favorite ? 'starred-symbolic' : 'non-starred-symbolic',
      _('Favorite'),
      () => this._controller.toggleFavorite(item.id),
    ));
    row.add_child(this._inlineButton('edit-delete-symbolic', _('Delete'), () => this._controller.remove(item.id)));
    return row;
  }

  _addCommonActions(menu, item) {
    menu.addAction(item.favorite ? _('Unfavorite') : _('Favorite'), () => this._controller.toggleFavorite(item.id));
    if (this._settings.get_string('sync-send-mode') === 'manual')
      menu.addAction(_('Send to sync service'), () => this._actions.publish(item));
    menu.addAction(_('Delete'), () => this._controller.remove(item.id));
  }

  _inlineButton(iconName, accessibleName, callback) {
    const button = new St.Button({
      can_focus: true,
      style_class: 'button clipboard-x-toolbar-button',
      accessible_name: accessibleName,
      child: new St.Icon({icon_name: iconName}),
    });
    button.connect('clicked', () => Promise.resolve(callback()).catch(error => this._actions.reportError(error)));
    return button;
  }

  _activate(item) {
    this.menu.close();
    this._actions.activateItem(item).catch(error => this._actions.reportError(error));
  }

  destroy() {
    if (this._changedSignal)
      this._controller.disconnect(this._changedSignal);
    this._changedSignal = 0;
    super.destroy();
  }
});

function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
