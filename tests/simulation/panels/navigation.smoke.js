import GLib from 'gi://GLib';
import {Session, assert} from './cases/session.js';
import {entrance, anchors, geometry, scene, returnToHistory} from './cases/entry.js';
import {firstTarget, matrix, boundaries, scrolling} from './cases/navigation.js';
import {verify as verifyInputMode} from './input-mode.smoke.js';
export {init} from './cases/session.js';

const cases = new Map([
  ['PANEL-01', entrance], ['PANEL-02', anchors], ['PANEL-03', geometry],
  ['PANEL-04', scene], ['PANEL-05', returnToHistory], ['PANEL-06', firstTarget],
  ['PANEL-07', matrix], ['PANEL-08', boundaries], ['PANEL-09', scrolling],
  ['PANEL-10', session => verifyInputMode(session.indicator)],
]);

export async function run() {
  const selected = (GLib.getenv('CBX_PANEL_TEST_CASES') ?? [...cases.keys()].join(',')).split(',');
  assert(selected.length > 0 && selected.every(id => cases.has(id)), 'Unknown or empty panel case selection');
  const session = await Session.create();
  try {
    await session.seed();
    for (const id of selected) await session.check(id, cases.get(id));
    print(`[panels] COMPLETE standard: ${selected.length} cases`);
  } finally {
    await session.destroy();
  }
}
