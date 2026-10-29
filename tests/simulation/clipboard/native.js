import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
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
};
