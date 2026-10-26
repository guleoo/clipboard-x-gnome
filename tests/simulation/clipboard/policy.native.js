import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';
import {restart} from '../helpers/restart.js';
import {capture} from './native.js';

async function offerFinished(desktop, target, text, other = {}) {
  const controller = desktop.app._controller;
  const revision = controller.selectionRevision;
  await target.offer(text, other);
  await until(() => controller.selectionRevision > revision && !controller._captureInProgress && !controller._captureQueued,
    'real policy capture completed');
}

async function pin(desktop, item) {
  await desktop.open();
  await desktop.click(desktop.history._itemRows.get(item.id).focusActors
    .find(actor => actor._clipboardXGnomeEntryAction === 'pin'));
  await until(() => item.favorite, 'native favorite action');
}

const sensitive = {'application/x-keepass2': new TextEncoder().encode('1')};

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

  async 'PRIV-03'(desktop) {
    const target = await Target.open(desktop);
    try {
      assert(desktop.settings.get_string('sensitive-content-mode') === 'discard', 'Sensitive content defaults to discard');
      await offerFinished(desktop, target, 'discarded sensitive content', sensitive);
      assert(desktop.app._controller.items.length === 0, 'Sensitive MIME must be discarded by default');
      desktop.settings.set_string('sensitive-content-mode', 'memory');
      await offerFinished(desktop, target, 'memory sensitive content', sensitive);
      const item = desktop.app._controller.items.find(value => value.text === 'memory sensitive content');
      assert(item?.sensitive, 'Memory policy must retain a sensitive item in this process only');
      await desktop.app._controller.persist();
      assert(!(await desktop.app._controller._store.load()).some(value => value.id === item.id),
        'Sensitive item must not appear in durable history');
      assert(!item.primary.path && !item.preview?.path, 'Sensitive content and preview must not acquire disk paths');
      await desktop.open();
      assert(!desktop.history._itemRows.get(item.id).focusActors.some(actor => actor._clipboardXGnomeEntryAction === 'sync'),
        'Sensitive item must not expose an upload action');
    } finally { await target.close(); }
  },

  async 'PRIV-04'(desktop) {
    const target = await Target.open(desktop);
    try {
      const windowClass = target.window.get_wm_class();
      assert(windowClass, 'Real target must have a discoverable window class');
      desktop.settings.set_strv('excluded-apps', [windowClass]);
      await offerFinished(desktop, target, 'excluded real application');
      assert(!desktop.app._controller.items.length, 'Focused excluded application must not be captured');
      desktop.settings.set_strv('excluded-apps', []);
      await capture(desktop, target, 'same application after exclusion removed');
    } finally { await target.close(); }
  },

  async 'PRIV-05'(desktop) {
    const target = await Target.open(desktop);
    try {
      const revision = desktop.app._controller.selectionRevision;
      await target.offerBytes({'text/plain;charset=utf-8': new TextEncoder().encode('cancelled policy snapshot')}, {pause: true});
      await until(() => desktop.app._controller.selectionRevision > revision && desktop.app._controller._captureInProgress,
        'external capture pending before policy change');
      desktop.settings.set_boolean('private-mode', true);
      desktop.settings.set_boolean('private-mode', false);
      await target.resume();
      await until(() => !desktop.app._controller._captureInProgress, 'cancelled policy read completes');
      assert(!desktop.app._controller.items.some(item => item.text === 'cancelled policy snapshot'),
        'Turning policy on and back off must still reject the old in-flight bytes');
      await capture(desktop, target, 'fresh public owner after cancelled policy');
    } finally { await target.close(); }
  },

  async 'PRIV-05-exclusion'(desktop) {
    const target = await Target.open(desktop);
    try {
      const controller = desktop.app._controller;
      const windowClass = target.window.get_wm_class();
      assert(windowClass, 'Actual owner must expose an exclusion class');
      for (const image of [false, true]) {
        const bytes = new TextEncoder().encode(image ? 'delayed invalid PNG source' : 'late excluded source');
        const revision = controller.selectionRevision;
        await target.offerBytes({[image ? 'image/png' : 'text/plain;charset=utf-8']: bytes}, {pause: true});
        await until(() => controller.selectionRevision > revision && controller._captureInProgress,
          'real owner transfer is pending before exclusion changes');
        desktop.settings.set_strv('excluded-apps', [windowClass]);
        desktop.settings.set_strv('excluded-apps', []);
        await target.resume();
        await until(() => !controller._captureInProgress && !controller._captureQueued, 'cancelled excluded owner finished');
        const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
        assert(!controller.items.some(item => item.primary.sha256 === hash),
          'Removing exclusion again must not revive bytes from the previous policy');
        await capture(desktop, target, `fresh allowed owner after exclusion ${image}`);
      }
    } finally { await target.close(); }
  },

  async 'PRIV-05-thumbnail'(desktop) {
    const target = await Target.open(desktop);
    const controller = desktop.app._controller;
    const store = controller._store;
    const stage = store.stage;
    let release;
    let pending;
    try {
      const windowClass = target.window.get_wm_class();
      assert(windowClass, 'Thumbnail source must have a real exclusion class');
      for (const policy of ['privacy', 'exclusion']) {
        let stagedPath;
        let stagedPreview;
        release = null;
        pending = null;
        // _prepareItem calls stage only after the real decoder/encoder has
        // produced its thumbnail. Hold that real staging completion, not a
        // fabricated preview or the controller's final policy check.
        store.stage = async function (content, write, cancellable) {
          pending = (async () => {
            const result = await stage.call(this, content, write, cancellable);
            stagedPath = result;
            stagedPreview = content;
            await new Promise(resolve => { release = resolve; });
            return result;
          })();
          return pending;
        };
        const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 640, 320);
        image.fill(policy === 'privacy' ? 0x336699ff : 0x996633ff);
        const bytes = image.save_to_bufferv('png', [], [])[1];
        const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
        await target.offerBytes({'image/png': bytes});
        await until(() => Boolean(release), 'real thumbnail decoded, encoded and staged before policy change');
        assert(controller._captureInProgress && stagedPreview.width > 0 && stagedPreview.height > 0
          && Gio.File.new_for_path(stagedPath).query_exists(null),
        'Gate must contain an actual on-disk thumbnail while capture is pending');
        if (policy === 'privacy') {
          desktop.settings.set_boolean('private-mode', true);
          desktop.settings.set_boolean('private-mode', false);
        } else {
          desktop.settings.set_strv('excluded-apps', [windowClass]);
          desktop.settings.set_strv('excluded-apps', []);
        }
        release();
        await pending;
        await until(() => !controller._captureInProgress && !controller._captureQueued,
          'late thumbnail capture discarded after policy transition');
        assert(!controller.items.some(item => item.primary.sha256 === hash),
          'Returning to the permissive policy must not revive an obsolete image capture');
        await until(() => !Gio.File.new_for_path(stagedPath).query_exists(null),
          'rejected capture must release its real staged thumbnail');
        await controller.persist();
        assert(!(await store.load()).some(item => item.primary.sha256 === hash),
          'Rejected image must not appear in durable history');
        store.stage = stage;
        await capture(desktop, target, 'fresh public owner after thumbnail policy ' + policy);
      }
    } finally {
      release?.();
      try { if (pending) await pending; } finally {
        store.stage = stage;
        await target.close();
      }
    }
  },

  async 'PRIV-07'(desktop) {
    const target = await Target.open(desktop);
    try {
      desktop.settings.set_string('sensitive-content-mode', 'memory');
      await offerFinished(desktop, target, 'pinned sensitive phrase', sensitive);
      const item = desktop.app._controller.items.find(value => value.sensitive);
      assert(item, 'Memory-only fixture captured');
      await pin(desktop, item);
      desktop.app._controller.clear();
      await desktop.app._controller.persist();
      assert(desktop.app._controller.items.some(value => value.id === item.id), 'Pinned sensitive item survives ordinary clear in memory');
      await restart(desktop);
      assert(!desktop.app._controller.items.some(value => value.id === item.id), 'Even pinned sensitive content must not survive restart');
    } finally { await target.close(); }
  },

  async 'HIST-01'(desktop) {
    const target = await Target.open(desktop);
    try {
      const pinned = await capture(desktop, target, 'older pinned item');
      await pin(desktop, pinned);
      await capture(desktop, target, 'newer ordinary item');
      await desktop.app._controller.persist();
      await restart(desktop);
      assert(desktop.app._controller.items[0].id === pinned.id && desktop.app._controller.items[0].favorite,
        'Favorite must remain first after actual extension restart');
      await desktop.open();
      await desktop.click(desktop.history._itemRows.get(pinned.id).focusActors
        .find(actor => actor._clipboardXGnomeEntryAction === 'pin'));
      await until(() => !desktop.app._controller.items.find(item => item.id === pinned.id).favorite, 'native unpin after restart');
    } finally { await target.close(); }
  },

  async 'HIST-04'(desktop) {
    const target = await Target.open(desktop);
    try {
      for (const value of ['Alpha Beta', '中文内容 🙂', 'another Alpha', 'No matching letters']) await capture(desktop, target, value);
      await desktop.open();
      for (const [query, count] of [['alpha', 2], [' ALPHA ', 2], ['absent-value', 0], ['', 4]]) {
        await desktop.search(query);
        await until(() => desktop.history._itemRows.size === count, `native search ${JSON.stringify(query)} results`);
      }
      // Paste Unicode instead of pretending virtual ASCII keymaps support CJK keyvals.
      await target.offer('中文');
      await desktop.open();
      await desktop.search('');
      await desktop.key(Clutter.KEY_v, [Clutter.KEY_Control_L]);
      await until(() => desktop.history._query === '中文' && desktop.history._itemRows.size === 2,
        'actual Unicode paste into search');
      await target.offer('🙂');
      await desktop.open();
      await desktop.search('');
      await desktop.key(Clutter.KEY_v, [Clutter.KEY_Control_L]);
      await until(() => desktop.history._query === '🙂' && desktop.history._itemRows.size === 2,
        'actual emoji paste searches the source and newly copied emoji without ASCII keymap assumptions');
      const limit = desktop.settings.get_int('panel-visible-item-limit');
      try {
        desktop.settings.set_int('panel-visible-item-limit', 1);
        await desktop.search('alpha');
        await until(() => desktop.history._itemRows.size === 1, 'filtered native results obey the configured limit');
        const [id] = desktop.history._itemRows.keys();
        assert(['Alpha Beta', 'another Alpha'].includes(desktop.app._controller.items.find(item => item.id === id)?.text),
          'Limiting filtered results must not replace a matching row with unrelated history');
        desktop.settings.set_int('panel-visible-item-limit', limit);
        await until(() => desktop.history._itemRows.size === 2, 'restoring the limit reveals the second retained match');
      } finally { desktop.settings.set_int('panel-visible-item-limit', limit); }
    } finally { await target.close(); }
  },

};
