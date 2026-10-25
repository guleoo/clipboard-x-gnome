import GdkPixbuf from 'gi://GdkPixbuf';
import GLib from 'gi://GLib';
import {assert, pause, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';

export const cases = {
  async 'OPS-01-capture'(desktop) {
    const target = await Target.open(desktop);
    // Generate fixtures before timing the production capture/thumbnail/save/UI chain.
    const text = new TextEncoder().encode('中文 English🙂\n'.repeat(40000));
    const width = 1200;
    const height = 800;
    const pixels = new Uint8Array(width * height * 3);
    let seed = 0x12345678;
    for (let index = 0; index < pixels.length; index++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels[index] = seed & 255;
    }
    const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(pixels), GdkPixbuf.Colorspace.RGB,
      false, 8, width, height, width * 3);
    const png = pixbuf.save_to_bufferv('png', [], [])[1];
    desktop.settings.set_int('capture-size-limit-mib', 16);
    let last = GLib.get_monotonic_time();
    let gap = 0;
    let ticks = 0;
    const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
      const now = GLib.get_monotonic_time();
      gap = Math.max(gap, (now - last) / 1000);
      ticks++; last = now;
      return GLib.SOURCE_CONTINUE;
    });
    try {
      for (const [mime, bytes] of [['text/plain;charset=utf-8', text], ['image/png', png]]) {
        const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
        const start = GLib.get_monotonic_time();
        gap = 0;
        await target.offerBytes({[mime]: bytes});
        await until(() => desktop.app._controller.items.some(item => item.primary.sha256 === hash
          && (!item.isImage || item.preview?.path)), 'large original and thumbnail captured', 15000);
        await desktop.app._controller.persist();
        await desktop.open();
        await until(() => desktop.history._itemRows.size > 0, 'large capture displayed');
        await desktop.close();
        await pause(30);
        print(`[simulation] Capture responsiveness: mime=${mime}; bytes=${bytes.length}; durationMs=${((GLib.get_monotonic_time() - start) / 1000).toFixed(1)}; maxGapMs=${gap.toFixed(1)}; budgetMs=1000`);
        assert(gap < 1000, 'Real capture, thumbnail, durable save and display must not stall Shell for one second');
      }
      assert(ticks > 5, 'The measurement must span actual event-loop turns, not callback return only');
    } finally {
      GLib.Source.remove(source);
      await target.close();
    }
  },
};
