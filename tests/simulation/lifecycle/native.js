import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, pause, until} from '../helpers/desktop.js';
import {restart} from '../helpers/restart.js';
import {Target} from '../helpers/target.js';

export const cases = {
  async 'ENV-05-screenshot'(desktop) {
    const target = await Target.open(desktop);
    try {
      for (const action of ['cancel', 'capture']) {
        const app = desktop.app;
        const controller = app._controller;
        const store = controller._store;
        const portal = app._portal;
        const capture = app._takeScreenshot;
        const calls = [];
        const observers = [];
        let pending;
        let settled = false;
        let failure = null;
        let screenshots = 0;
        const signal = Main.screenshotUI.connect('screenshot-taken', () => screenshots++);
        // Observe production operations without replacing their outcomes. Shell's
        // own screenshot behavior is distinct from writes by the disabled plugin.
        for (const [object, name] of [[controller, 'addFromUri'], [controller, 'createFromUri'],
          [controller, 'writeScreenshot'], [app, '_launchEditor'], [app, '_reportError']]) {
          const original = object[name];
          object[name] = function (...args) {
            // _reportError intentionally ignores a Gio cancellation. Observe
            // user-visible errors, not that harmless route through its guard.
            if (name !== '_reportError' || !args[0]?.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
              calls.push(name);
            return original.apply(this, args);
          };
          observers.push(() => { object[name] = original; });
        }
        app._takeScreenshot = function (...args) {
          pending = capture.apply(this, args);
          pending.then(() => { settled = true; }, error => { failure = error; settled = true; });
          return pending;
        };
        try {
          await target.offer('disable during a real screenshot ' + action);
          await until(() => controller.items.some(item => item.text.endsWith('screenshot ' + action))
            && !controller._captureInProgress && !controller._captureQueued, 'baseline clipboard capture finished');
          await controller.persist();
          const ids = (await store.load()).map(item => item.id).sort().join();
          const initialModal = Main.modalCount;
          desktop.settings.set_string('screenshot-target', 'interactive');
          desktop.settings.set_boolean('screenshot-add-history', true);
          desktop.settings.set_boolean('screenshot-write-clipboard', true);
          desktop.settings.set_boolean('screenshot-open-editor', true);
          desktop.settings.set_string('editor-command', '/usr/bin/true %f');
          await desktop.open();
          await desktop.click(desktop.history.screenshotButton);
          await until(() => pending && portal._request && Main.screenshotUI.visible,
            'real portal request and shared ScreenshotUI are active', 15000);
          const request = portal._request;
          await restart(desktop, async () => {
            await until(() => settled, 'old extension screenshot pipeline settles after disable');
            assert(!failure || failure.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
              'Disabling the request must not produce an unexpected screenshot failure');
            assert(!portal._request && request.subscriptionId === 0 && request.timeoutId === 0
              && request.cancellable.is_cancelled(), 'Disable releases the owned request, subscription and timeout');
            // The system-owned UI may remain open. User completion/cancellation,
            // not immediate UI disappearance at disable, is the acceptance point.
            const visible = Main.screenshotUI.visible;
            if (visible) {
              await pause(100);
              await desktop.key(action === 'cancel' ? Clutter.KEY_Escape : Clutter.KEY_Return);
            }
            await until(() => !Main.screenshotUI.visible && Main.modalCount <= initialModal,
              'system screenshot completion/cancellation releases its modal', 15000);
            if (action === 'capture' && visible)
              await until(() => screenshots === 1, 'actual system screenshot finished after extension disable');
            else assert(screenshots === 0, 'Cancel must not capture a screenshot');
            await target.call('clear');
            Main.activateWindow(target.window);
            await until(() => global.display.focus_window === target.window, 'external target regains focus after screenshot');
            const box = target.window.get_frame_rect();
            await desktop.pointClick(box.x + box.width / 2, box.y + box.height / 2);
            const text = 'Shell accepts native input after ' + action;
            await desktop.type(text);
            await until(() => target.state.text === text, 'real application receives native keyboard input after screenshot');
            assert(calls.length === 0, `Disabled plugin must not import, copy, launch an editor or notify a late screenshot error (${calls.join(',')})`);
            assert((await store.load()).map(item => item.id).sort().join() === ids,
              'Late system screenshot must not change the disabled plugin history');
          });
          assert(!desktop.app._controller.items.some(item => item.isImage), 'New controller must not adopt the old capture');
          await desktop.open();
          assert(desktop.indicator.menu.isOpen, 'Extension can reopen normally after system screenshot settles');
          await desktop.close();
          print(`[simulation] Disabled screenshot ${action}: actualCaptures=${screenshots}; modal=${Main.modalCount}; native target and reopened panel responsive`);
        } finally {
          app._takeScreenshot = capture;
          for (const restore of observers) restore();
          Main.screenshotUI.disconnect(signal);
          if (Main.screenshotUI.visible) await desktop.key(Clutter.KEY_Escape);
        }
      }
    } finally {
      if (Main.screenshotUI.visible) await desktop.key(Clutter.KEY_Escape);
      await target.close();
    }
  },
};
