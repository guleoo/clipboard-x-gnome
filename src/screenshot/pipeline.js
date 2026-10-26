import Gio from 'gi://Gio';

// The Shell adapter supplies its current-instance boundary. The pipeline owns
// only operation ordering; no compositor, clipboard or notification globals.
export async function capture({controller, settings, portal, isCurrent, openEditor}) {
  const check = () => {
    if (!controller || !isCurrent())
      throw new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED, message: 'Screenshot operation was stopped'});
  };
  check();
  const uri = await portal.capture(settings.get_string('screenshot-target'));
  check();
  if (uri === null)
    return;
  const item = settings.get_boolean('screenshot-add-history')
    ? await controller.addFromUri(uri, 'screenshot')
    : await controller.createFromUri(uri);
  check();
  if (settings.get_boolean('screenshot-write-clipboard')) {
    await controller.writeScreenshot(item);
    check();
  }
  if (settings.get_boolean('screenshot-open-editor')) {
    await openEditor(uri);
    check();
  }
}
