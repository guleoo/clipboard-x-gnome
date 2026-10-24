import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {assert, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';

export async function capture(desktop, target, text) {
  await target.offer(text);
  await until(() => desktop.app._controller.items.some(item => item.text === text), 'capture external text');
  return desktop.app._controller.items.find(item => item.text === text);
}

export async function activate(desktop, item, method) {
  await desktop.open();
  const row = desktop.history._itemRows.get(item.id);
  assert(row, 'Captured item must render a content row');
  if (method === 'click') await desktop.click(row.focusActors[0]);
  else {
    await desktop.key(Clutter.KEY_Down);
    assert(global.stage.get_key_focus() === row.focusActors[0], 'Down must focus the captured item');
    await desktop.key(Clutter.KEY_Return);
  }
  await until(() => !desktop.indicator.menu.isOpen, 'copy closes popup');
}

export const cases = {
  async 'CLIP-01'(desktop) {
    const target = await Target.open(desktop);
    try {
      for (const text of ['external ASCII', '中文 English 日本語 한국어 🙂', 'line one\nline two\tend',
        'combining e\u0301 👨‍👩‍👧‍👦', 'long text '.repeat(1000)]) {
        const item = await capture(desktop, target, text);
        await activate(desktop, item, 'click');
        assert((await target.clipboard()).text === text, 'External clipboard readback must equal the original text');
      }
    } finally { await target.close(); }
  },

  async 'CLIP-09'(desktop) {
    const target = await Target.open(desktop);
    try {
      for (const method of ['click', 'enter']) {
        const text = `original content activated with ${method}`;
        const item = await capture(desktop, target, text);
        await target.offer('different current clipboard');
        await until(() => desktop.app._controller.items.some(value => value.text === 'different current clipboard'), 'second capture');
        // Search through real input so the intended row is the first result.
        await desktop.open();
        await desktop.search(text);
        await until(() => desktop.history._itemRows.size === 1, 'searched capture');
        if (method === 'click') await desktop.click(desktop.history._itemRows.get(item.id).focusActors[0]);
        else { await desktop.key(Clutter.KEY_Down); await desktop.key(Clutter.KEY_Return); }
        assert((await target.clipboard()).text === text, 'Native activation must replace the actual system clipboard');
      }
    } finally { await target.close(); }
  },

  async 'CLIP-04'(desktop) {
    const target = await Target.open(desktop);
    try {
      const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 8, 4);
      image.fill(0x336699ff);
      const types = {
        'image/png': image.save_to_bufferv('png', [], [])[1],
        'image/jpeg': image.save_to_bufferv('jpeg', [], [])[1],
        'image/webp': GLib.base64_decode('UklGRjgAAABXRUJQVlA4ICwAAADwAQCdASoIAAQAAUAmJaACdLoB+AAETAAA/u+9V/43bjDfgu/33oDeBgAAAA=='),
        'image/gif': GLib.base64_decode('R0lGODdhCAAEAIEAADNmmQAAAAAAAAAAACwAAAAACAAEAAAIDAABCBxIsKDBgwQDAgA7'),
        'image/svg+xml': new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4" fill="#336699"/></svg>'),
      };
      for (const [mime, bytes] of Object.entries(types)) {
        const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
        await target.offerBytes({[mime]: bytes});
        await until(() => desktop.app._controller.items.some(item => item.primary.sha256 === hash), `${mime} captured`);
        const item = desktop.app._controller.items.find(value => value.primary.sha256 === hash);
        assert(item.primary.mimeType === mime && item.primary.size === bytes.length, `${mime} must retain exact representation`);
      }
      await capture(desktop, target, 'valid capture after image formats');
    } finally { await target.close(); }
  },

  async 'CLIP-05'(desktop) {
    const target = await Target.open(desktop);
    try {
      for (const [width, height] of [[640, 40], [40, 640], [1200, 800]]) {
        const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, width, height);
        image.fill(0x336699ff);
        const [, bytes] = image.save_to_bufferv('png', [], []);
        const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
        await target.offerBytes({'image/png': bytes});
        await until(() => desktop.app._controller.items.some(item => item.primary.sha256 === hash && item.preview?.path), 'image thumbnail');
        const item = desktop.app._controller.items.find(value => value.primary.sha256 === hash);
        await desktop.open();
        const row = desktop.history._itemRows.get(item.id);
        const images = row.focusActors[0].get_child().get_children()
          .find(child => child.has_style_class_name?.('cbx-image-content'));
        const thumbnail = images.get_children()[0];
        await until(() => thumbnail.mapped && thumbnail.width > 0, 'thumbnail allocation');
        assert(Math.abs(thumbnail.width / thumbnail.height - width / height) < 0.03,
          'Allocated thumbnail must preserve original aspect ratio');
        await desktop.click(row.focusActors[0]);
        const actual = await target.clipboard('image/png');
        assert(actual.sha256 === hash && actual.size === bytes.length, 'Image activation must copy original bytes, not thumbnail');
      }
    } finally { await target.close(); }
  },

  async 'CLIP-06'(desktop) {
    const target = await Target.open(desktop);
    desktop.settings.set_int('capture-size-limit-mib', 1);
    try {
      for (const delta of [-1, 0, 1]) {
        const text = String(delta).padEnd(1024 * 1024 + delta, 'x');
        const revision = desktop.app._controller.selectionRevision;
        await target.offer(text);
        await until(() => desktop.app._controller.selectionRevision > revision
          && !desktop.app._controller._captureInProgress && !desktop.app._controller._captureQueued,
          'bounded external capture completed');
        const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, new TextEncoder().encode(text));
        const found = desktop.app._controller.items.find(item => item.primary.sha256 === hash);
        assert(delta > 0 ? !found : Boolean(found), `Capture boundary ${delta} must not accept truncation as complete`);
      }
    } finally { await target.close(); }
  },

  async 'CLIP-07'(desktop) {
    const slow = await Target.open(desktop);
    const newer = await Target.open(desktop);
    try {
      const old = 'obsolete delayed external owner';
      const revision = desktop.app._controller.selectionRevision;
      await slow.offerBytes({'text/plain;charset=utf-8': new TextEncoder().encode(old)}, {pause: true});
      await until(() => desktop.app._controller.selectionRevision > revision && desktop.app._controller._captureInProgress,
        'controller reading the paused source');
      const switched = desktop.app._controller.selectionRevision;
      await newer.offer('newer external clipboard wins');
      await until(() => desktop.app._controller.selectionRevision > switched, 'new owner observed while old source is stopped');
      // Mutter 50 can retain the old read until its source responds. Release it
      // only after the owner change, then require its late bytes to be rejected.
      await slow.resume();
      await until(() => desktop.app._controller.items.some(item => item.text === 'newer external clipboard wins'),
        'new owner captured after delayed old response');
      await Scripting.waitLeisure();
      assert(!desktop.app._controller.items.some(item => item.text === old), 'Late old owner must not enter history');
      const before = desktop.app._controller.selectionRevision;
      await newer.offerBytes({'text/plain;charset=utf-8': new TextEncoder().encode('exited source')}, {pause: true});
      await until(() => desktop.app._controller.selectionRevision > before && desktop.app._controller._captureInProgress,
        'controller reading the exiting source');
      await newer.close();
      await capture(desktop, slow, 'capture after source exit');
      for (let index = 0; index < 12; index++) await slow.offer(`rapid external owner ${index}`);
      await until(() => desktop.app._controller.items.some(item => item.text === 'rapid external owner 11'), 'final rapid owner');
    } finally { await newer.close(); await slow.close(); }
  },

  async 'CLIP-08'(desktop) {
    const target = await Target.open(desktop);
    try {
      const item = await capture(desktop, target, 'recopied pinned content');
      await desktop.open();
      await desktop.click(desktop.history._itemRows.get(item.id).focusActors.find(actor => actor._clipboardXGnomeEntryAction === 'pin'));
      await target.offer(item.text);
      await until(() => !desktop.app._controller._captureInProgress, 'recopy completed');
      assert(desktop.app._controller.items.filter(value => value.text === item.text).length === 1 && item.favorite,
        'External recopy must dedupe and preserve favorite');
      const count = desktop.app._controller.items.length;
      await activate(desktop, item, 'click');
      await target.clipboard();
      await Scripting.waitLeisure();
      assert(desktop.app._controller.items.length === count, 'Activation owner change must not create a loop');
    } finally { await target.close(); }
  },

  async 'CLIP-10'(desktop) {
    const target = await Target.open(desktop);
    try {
      const item = await capture(desktop, target, 'row actions must not copy this');
      const sentinel = 'unchanged external clipboard';
      await capture(desktop, target, sentinel);
      for (const action of ['pin', 'tokenize', 'delete']) {
        await desktop.open();
        await desktop.search(item.text);
        await until(() => desktop.history._itemRows.size === 1, 'row action search');
        const button = desktop.history._itemRows.get(item.id).focusActors.find(actor => actor._clipboardXGnomeEntryAction === action);
        assert(button, `Expected ${action} action`);
        await desktop.click(button);
        if (action === 'tokenize') await until(() => desktop.manager.is('tokenizer'), 'word action opened');
        assert((await target.clipboard()).text === sentinel, `${action} must not activate the content button`);
        desktop.manager.reset();
      }
      await capture(desktop, target, 'new capture after deleting row');
      assert(!desktop.app._controller.items.some(value => value.id === item.id), 'Native Delete must remove only its item');
      const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 32, 16);
      image.fill(0x669933ff);
      const bytes = image.save_to_bufferv('png', [], [])[1];
      await target.offerBytes({'image/png': bytes});
      await until(() => desktop.app._controller.items.some(value => value.isImage && value.preview?.path), 'image action fixture');
      const imageItem = desktop.app._controller.items.find(value => value.isImage);
      await capture(desktop, target, sentinel);
      desktop.settings.set_string('editor-command', '/usr/bin/true %f');
      desktop.settings.set_string('sync-send-mode', 'manual');
      desktop.settings.set_boolean('sync-enabled', true);
      for (const action of ['edit', 'sync']) {
        await desktop.open();
        // The older image row remains inside the viewport of this small fixture.
        const row = desktop.history._itemRows.get(imageItem.id);
        const button = row.focusActors.find(actor => actor._clipboardXGnomeEntryAction === action);
        assert(button?.visible, `Image must expose ${action}`);
        await desktop.click(button);
        await Scripting.waitLeisure();
        assert((await target.clipboard()).text === sentinel, `${action} must not copy the image`);
      }
    } finally { await target.close(); }
  },

  async 'CLIP-11'(desktop) {
    const target = await Target.open(desktop);
    try {
      const source = 'native ctrl click waits then types';
      const item = await capture(desktop, target, source);
      await target.call('clear');
      await desktop.open();
      desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.PRESSED);
      try {
        await desktop.click(desktop.history._itemRows.get(item.id).focusActors[0]);
        await until(() => Boolean(desktop.app._terminalInput._typing), 'Ctrl-click starts queued typing');
        assert(target.state.text === '', 'Held Ctrl must not become shortcuts or text');
      } finally {
        desktop.keyboard.notify_keyval(GLib.get_monotonic_time(), Clutter.KEY_Control_L, Clutter.KeyState.RELEASED);
      }
      await until(() => target.state.text === source && !desktop.app._terminalInput._typing,
        'Ctrl-click output reaches the original target exactly', 10000);
    } finally { await target.close(); }
  },
};
