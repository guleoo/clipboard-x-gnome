import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// GNOME's portal backend reports closing its interactive UI as response 2,
// which also covers real failures. Only an explicit dismissal of the UI opened
// during this request can disambiguate that response.
export function observeCancellation(onCancelled) {
  const ui = Main.screenshotUI;
  if (ui.visible)
    return () => {};

  let opened = false;
  let dismissed = false;
  let captured = false;
  let closed = false;
  let stopped = false;
  let keyController = null;
  const signals = [];
  const connect = (actor, signal, callback) => signals.push([actor, actor.connect(signal, callback)]);
  const disconnect = () => {
    stopped = true;
    for (const [actor, signal] of signals.splice(0))
      actor.disconnect(signal);
    if (keyController) {
      ui.remove_action(keyController);
      keyController = null;
    }
  };
  connect(ui, 'notify::visible', () => {
    if (ui.visible)
      opened = true;
  });
  connect(ui, 'screenshot-taken', () => { captured = true; });
  connect(ui._closeButton, 'clicked', () => {
    if (opened)
      dismissed = true;
  });
  const observeKey = symbol => {
    if (opened && !closed && ui.visible && symbol === Clutter.KEY_Escape)
      dismissed = true;
    return Clutter.EVENT_PROPAGATE;
  };
  // Install before the portal opens the UI so GNOME 51's GrabHelper cannot
  // consume Escape first. GNOME 50 uses the stage's captured-event instead.
  if (Clutter.KeyController) {
    keyController = new Clutter.KeyController();
    connect(keyController, 'key-press', controller => observeKey(controller.get_key()[1]));
    ui.add_action_full('clipboard-x-gnome-screenshot-cancel', Clutter.EventPhase.CAPTURE, keyController);
  } else {
    connect(global.stage, 'captured-event', (_actor, event) => {
      if (event.type() === Clutter.EventType.KEY_PRESS)
        return observeKey(event.get_key_symbol());
      return Clutter.EVENT_PROPAGATE;
    });
  }
  connect(ui, 'closed', () => {
    closed = true;
    // With animations disabled, Shell's earlier clicked handler emits closed
    // synchronously. Finish after this emission so our clicked handler still
    // records the actual activation (a press followed by dragging away is not
    // cancellation).
    Promise.resolve().then(() => {
      if (stopped)
        return;
      if (opened && dismissed && !captured)
        onCancelled();
      disconnect();
    });
  });
  return disconnect;
}
