import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {capture} from './native.js';

async function offerFinished(desktop, target, text, other = {}) {
  const controller = desktop.app._controller;
  const revision = controller.selectionRevision;
  await target.offer(text, other);
  await until(() => controller.selectionRevision > revision && !controller._captureInProgress && !controller._captureQueued,
    'real policy capture completed');
}

export const cases = {
  async 'PRIV-01'(desktop) {
    const target = await Target.open(desktop);
    try {
      assert(!desktop.settings.get_boolean('private-mode'), 'Privacy mode defaults off');
      await capture(desktop, target, 'public before privacy');
      await desktop.open();
      await desktop.click(desktop.history.privateButton);
      await until(() => desktop.settings.get_boolean('private-mode'), 'privacy icon enables mode');
      await offerFinished(desktop, target, 'private clipboard must remain unrecorded');
      assert(!desktop.app._controller.items.some(item => item.text === 'private clipboard must remain unrecorded'),
        'Privacy mode must reject actual owner changes');
      await desktop.open();
      await desktop.click(desktop.history.privateButton);
      await until(() => !desktop.settings.get_boolean('private-mode'), 'privacy icon disables mode');
      await capture(desktop, target, 'public after privacy');
    } finally { await target.close(); }
  },
};
