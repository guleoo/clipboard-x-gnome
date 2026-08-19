import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {parse as parseColor} from '../../../color-picker/color.js';
import {ContentItem} from '../../controls/content-item.js';

const IMAGE_PREVIEW_HEIGHT = 40;
const IMAGE_PREVIEW_MAX_WIDTH = 80;

export function create({
  item,
  leading = null,
  accentColor = null,
  syncButton = null,
  createIconButton,
  actions,
}) {
  const row = new ContentItem();
  const swatch = colorSwatch(item);

  const content = new St.Button({
    can_focus: true,
    track_hover: true,
  });
  const contentBody = new St.BoxLayout({
    style_class: 'cbx-entry-body',
    x_expand: true,
    x_align: Clutter.ActorAlign.FILL,
    y_align: Clutter.ActorAlign.CENTER,
  });
  if (leading)
    contentBody.add_child(leading);
  if (swatch)
    contentBody.add_child(swatch);
  contentBody.add_child(item.isText ? textPreview(item) : imagePreview(item));
  content.set_child(contentBody);
  content._clipboardXTypeOnClick = false;
  content.connect('button-press-event', (_button, event) => {
    content._clipboardXTypeOnClick = event.get_button() === Clutter.BUTTON_PRIMARY
      && Boolean(event.get_state() & Clutter.ModifierType.CONTROL_MASK);
    return Clutter.EVENT_PROPAGATE;
  });
  content.connect('key-press-event', (_button, event) => {
    content._clipboardXTypeOnClick = false;
    const result = actions.handleKey(event);
    return result === Clutter.EVENT_PROPAGATE ? actions.handlePanelKey(event) : result;
  });
  content.connect('clicked', () => {
    const type = content._clipboardXTypeOnClick;
    content._clipboardXTypeOnClick = false;
    if (type)
      actions.type();
    else
      actions.activate();
  });
  content.accessible_name = item.remote && item.availability !== 'ready'
    ? _('Download original and copy')
    : _('Copy original');
  row.setContent(content);

  row.addAction(item.isText
    ? createIconButton(
      'format-text-plaintext-symbolic',
      _('Segment text'),
      actions.tokenize,
      {showTooltip: false},
    )
    : createIconButton(
      'document-edit-symbolic',
      _('Edit image'),
      actions.edit,
      {showTooltip: false},
    ));
  const pinButton = createIconButton(
    'view-pin-symbolic',
    item.favorite ? _('Unpin') : _('Pin'),
    actions.togglePin,
    {showTooltip: false, stateful: true},
  );
  pinButton.toggle_mode = true;
  pinButton.selected = item.favorite;
  if (item.favorite)
    pinButton.add_style_class_name('cbx-pinned');
  if (item.favorite && accentColor)
    pinButton.set_style(`color: ${accentColor};`);
  row.addAction(pinButton);
  if (syncButton)
    row.addAction(syncButton);
  row.addAction(createIconButton(
    'user-trash-symbolic',
    _('Delete from local history'),
    actions.remove,
    {showTooltip: false},
  ));
  row._clipboardXFocusRow = row.focusActors;
  for (const actor of row._clipboardXFocusRow)
    actor._clipboardXHistoryRow = row;
  row.connect('key-press-event', (_row, event) => actions.handleKey(event));
  return row;
}

function colorSwatch(item) {
  if (!item.isText || item.preview?.truncated)
    return null;
  const color = parseColor(item.text);
  if (!color)
    return null;
  const swatch = new St.Widget({
    style_class: 'cbx-color-swatch',
    reactive: false,
    can_focus: false,
    y_align: Clutter.ActorAlign.CENTER,
  });
  swatch.set_style(
    `background-color: rgba(${color.red}, ${color.green}, ${color.blue}, ${color.alpha});`,
  );
  return swatch;
}

function textPreview(item) {
  const title = item.preview?.text?.replaceAll('\n', ' ') || _('Text');
  const preview = new St.Label({
    text: title.slice(0, 240),
    style_class: 'cbx-entry-preview',
    x_expand: true,
    x_align: Clutter.ActorAlign.FILL,
    y_align: Clutter.ActorAlign.CENTER,
  });
  preview.clutter_text.single_line_mode = true;
  preview.clutter_text.ellipsize = Pango.EllipsizeMode.END;
  return preview;
}

function imagePreview(item) {
  const box = new St.BoxLayout({
    style_class: 'cbx-image-content',
    x_expand: true,
    x_align: Clutter.ActorAlign.START,
    y_align: Clutter.ActorAlign.CENTER,
  });
  if (item.preview?.path) {
    const [width, height] = imagePreviewSize(item.preview);
    box.add_child(new St.Icon({
      gicon: Gio.icon_new_for_string(item.preview.path),
      icon_size: Math.max(width, height),
      width,
      height,
      y_align: Clutter.ActorAlign.CENTER,
    }));
  } else {
    box.add_child(new St.Icon({
      icon_name: 'image-x-generic-symbolic',
      icon_size: 24,
      y_align: Clutter.ActorAlign.CENTER,
    }));
  }
  box.add_child(new St.Label({
    text: [imageFormat(item.primary?.mimeType), formatBytes(item.primary?.size ?? 0)].join(' · '),
    y_align: Clutter.ActorAlign.CENTER,
  }));
  return box;
}

function imagePreviewSize(preview) {
  const sourceWidth = Number(preview?.width);
  const sourceHeight = Number(preview?.height);
  if (!(sourceWidth > 0) || !(sourceHeight > 0))
    return [IMAGE_PREVIEW_HEIGHT, IMAGE_PREVIEW_HEIGHT];
  const scale = Math.min(
    IMAGE_PREVIEW_MAX_WIDTH / sourceWidth,
    IMAGE_PREVIEW_HEIGHT / sourceHeight,
  );
  return [
    Math.max(1, Math.round(sourceWidth * scale)),
    Math.max(1, Math.round(sourceHeight * scale)),
  ];
}

function imageFormat(mimeType) {
  if (!mimeType?.startsWith('image/'))
    return _('Image');
  const subtype = mimeType.slice('image/'.length).replace(/^x-/u, '').split('+', 1)[0];
  return subtype ? subtype.toUpperCase() : _('Image');
}

function formatBytes(bytes) {
  if (bytes < 1024)
    return `${bytes} B`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
