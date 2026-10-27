import Gio from 'gi://Gio';
import {assert} from './desktop.js';

// Observe the Shell process, not its helper processes. These values describe a
// bounded trend; allocator caches and unrelated services preclude a leak budget.
export function sample(cycle, phase) {
  const [, bytes] = Gio.File.new_for_path('/proc/self/status').load_contents(null);
  const rssKB = Number(new TextDecoder().decode(bytes).match(/^VmRSS:\s+(\d+)\s+kB$/mu)?.[1]);
  const descriptors = Gio.File.new_for_path('/proc/self/fd').enumerate_children(
    'standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  let openFDs = 0;
  try { while (descriptors.next_file(null)) openFDs++; }
  finally { descriptors.close(null); }
  assert(Number.isFinite(rssKB) && rssKB > 0 && openFDs > 0,
    'Resource observations must come from the actual Shell process');
  print(`[simulation] Bounded resources: cycle=${cycle}; phase=${phase}; rssKB=${rssKB}; openFDs=${openFDs}`);
  return {cycle, phase, rssKB, openFDs};
}
