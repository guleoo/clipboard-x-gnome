import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {assert, waitUntil, imageBytes} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function images(indicator, extensionObject) {
  const history = indicator._historyPanel;
  const {ClipboardItem} = await import(`${extensionObject.dir.get_uri()}/clipboard/item.js`);
  const png = imageBytes();
  const content = extensionObject._content;
  const prepareFile = content.file;
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
    indicator._controller.remove(imageItem.id);
  } finally {
    content.file = prepareFile;
    history._closeMenu = closeMenu;
    indicator.menu.close();
  }
}

export function run() {
  return runChecks([['images', images]]);
}
