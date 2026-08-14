import GLib from 'gi://GLib';

import {ClipboardItem} from '../src/clipboard-item.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const started = GLib.get_monotonic_time();
const text = '剪贴板 Clipboard X 👋\n'.repeat(Math.ceil(10 * 1024 * 1024 / 26));
const largeText = ClipboardItem.fromText(text, {textPreviewLimit: 4096});
assert(largeText.primary.size >= 10 * 1024 * 1024, 'stress text fixture must be at least 10 MiB');
assert(largeText.preview.truncated, '10 MiB text must use a truncated preview');
assert(new TextEncoder().encode(largeText.preview.text).length <= 4096, 'large text preview must respect its byte limit');

const imagePayload = new Uint8Array(50 * 1024 * 1024);
for (let offset = 0; offset < imagePayload.length; offset += 1024 * 1024)
  imagePayload[offset] = offset / (1024 * 1024);
const largeImage = ClipboardItem.fromBytes('image/png', new GLib.Bytes(imagePayload));
assert(largeImage.primary.size === 50 * 1024 * 1024, 'stress image fixture must be 50 MiB');
assert(largeImage.preview.path === null, 'large image metadata must not pretend to contain a thumbnail');

const elapsedSeconds = (GLib.get_monotonic_time() - started) / 1_000_000;
assert(elapsedSeconds < 10, `large item metadata processing took ${elapsedSeconds.toFixed(2)} seconds`);
