import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';
import {assert, waitUntil, imageBytes} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function screenshots(indicator, extensionObject) {
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
  } finally {
    extensionObject._launchEditor = launchEditor;
    extensionObject._portal = screenshotPortal;
    if (!screenshotStream.is_closed())
      screenshotStream.close(null);
    screenshotFile.delete(null);
    indicator.menu.close();
  }
}


export function run() {
  return runChecks([['screenshots', screenshots]]);
}
