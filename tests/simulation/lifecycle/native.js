import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {restart} from '../helpers/restart.js';
import {Target} from '../helpers/target.js';

export const cases = {
  async 'ENV-05-screenshot'(desktop) {
    const target = await Target.open(desktop);
    const app = desktop.app;
    const portal = app._portal;
    const capture = app._takeScreenshot;
    const initialModal = Main.modalCount;
    let pending;
    let state;
    app._takeScreenshot = function (...args) {
      pending = capture.apply(this, args).then(() => null, error => error);
      return pending;
    };
    try {
      await target.offer('disable during a real screenshot');
      desktop.settings.set_string('screenshot-target', 'interactive');
      await desktop.open();
      await desktop.click(desktop.history.screenshotButton);
      await until(() => pending && portal._request && Main.screenshotUI.visible,
        'real portal request and shared ScreenshotUI are active', 15000);
      const request = portal._request;
      await restart(desktop, async () => {
        await pending;
        // Observe before fixture cleanup: a native Escape afterward is not a
        // production cancellation result and must not make this assertion green.
        await pause(100);
        state = {visible: Main.screenshotUI.visible, modal: Main.modalCount,
          request: portal._request, subscription: request.subscriptionId, timeout: request.timeoutId,
          cancelled: request.cancellable.is_cancelled()};
        if (Main.screenshotUI.visible) {
          await desktop.key(Clutter.KEY_Escape);
          await until(() => !Main.screenshotUI.visible, 'owned screenshot fixture cleanup');
        }
      });
      assert(!state.request && state.subscription === 0 && state.timeout === 0 && state.cancelled,
        'Disable must cancel the real request, subscription and timeout');
      assert(!state.visible && state.modal <= initialModal,
        'Disable during screenshot must leave no shared ScreenshotUI/modal requiring manual dismissal');
      assert(!desktop.app._controller.items.some(item => item.isImage), 'Cancelled old capture must not reach the new controller');
    } finally {
      app._takeScreenshot = capture;
      if (Main.screenshotUI.visible) await desktop.key(Clutter.KEY_Escape);
      await target.close();
    }
  },
};
