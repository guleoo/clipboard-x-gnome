import Gio from 'gi://Gio';
import {capture} from '../../../src/screenshot/pipeline.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const uri = 'file:///tmp/headless-screenshot.png';
function fixture(options = {}) {
  const calls = [];
  const item = {id: 'pipeline-image'};
  const booleans = {
    'screenshot-add-history': true,
    'screenshot-write-clipboard': true,
    'screenshot-open-editor': true,
    ...options,
  };
  return {calls, item, booleans, dependencies: {
    settings: {get_string: () => 'screen', get_boolean: key => booleans[key]},
    portal: {capture: async target => { calls.push(`capture:${target}`); return uri; }},
    controller: {
      addFromUri: async (value, source) => { assert(value === uri && source === 'screenshot', 'History receives original URI/source'); calls.push('history'); return item; },
      createFromUri: async value => { assert(value === uri, 'Transient image receives original URI'); calls.push('transient'); return item; },
      writeScreenshot: async value => { assert(value === item, 'Clipboard receives the pipeline item'); calls.push('clipboard'); },
    },
    isCurrent: () => true,
    openEditor: async value => { assert(value === uri, 'Editor receives the original URI'); calls.push('editor'); },
  }};
}

for (const history of [false, true]) for (const clipboard of [false, true]) for (const editor of [false, true]) {
  const {calls, dependencies} = fixture({'screenshot-add-history': history,
    'screenshot-write-clipboard': clipboard, 'screenshot-open-editor': editor});
  await capture(dependencies);
  const expected = ['capture:screen', history ? 'history' : 'transient',
    ...(clipboard ? ['clipboard'] : []), ...(editor ? ['editor'] : [])];
  assert(calls.join() === expected.join(), 'Each screenshot policy combination preserves ordered independent effects');
}

for (const history of [false, true]) {
  const {calls, dependencies} = fixture({'screenshot-add-history': history});
  dependencies.portal.capture = async () => { calls.push('cancel'); return null; };
  await capture(dependencies);
  assert(calls.join() === 'cancel', 'User cancellation must not import, copy, launch an editor or reject');
}

for (const phase of ['portal', 'import', 'clipboard', 'editor']) {
  const {dependencies, calls} = fixture();
  const failure = new Error(`Injected ${phase} error`);
  const fail = async () => { calls.push('failure'); throw failure; };
  if (phase === 'portal') dependencies.portal.capture = fail;
  else if (phase === 'import') dependencies.controller.addFromUri = fail;
  else if (phase === 'clipboard') dependencies.controller.writeScreenshot = fail;
  else dependencies.openEditor = fail;
  let error;
  try { await capture(dependencies); } catch (caught) { error = caught; }
  assert(error === failure && calls.at(-1) === 'failure', 'Failures preserve identity and stop later screenshot effects');
}

for (const phase of ['portal', 'import', 'clipboard', 'editor']) {
  const {dependencies, calls, item} = fixture();
  let release;
  let entered;
  let active = true;
  const pendingStage = new Promise(resolve => { entered = resolve; });
  const delayed = async () => {
    calls.push(phase);
    entered();
    await new Promise(resolve => { release = resolve; });
    return phase === 'portal' ? uri : item;
  };
  if (phase === 'portal') dependencies.portal.capture = delayed;
  else if (phase === 'import') dependencies.controller.addFromUri = delayed;
  else if (phase === 'clipboard') dependencies.controller.writeScreenshot = delayed;
  else dependencies.openEditor = delayed;
  dependencies.isCurrent = () => active;
  const operation = capture(dependencies).then(() => null, error => error);
  await pendingStage;
  active = false;
  release();
  const error = await operation;
  assert(error?.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) && calls.at(-1) === phase,
    'Invalidating the instance at every async boundary must cancel before the next effect');
}

const stopped = fixture();
stopped.dependencies.isCurrent = () => false;
let cancelled;
try { await capture(stopped.dependencies); } catch (error) { cancelled = error; }
assert(cancelled?.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) && stopped.calls.length === 0,
  'An already stopped instance must not even contact the portal');

const live = fixture({'screenshot-write-clipboard': false});
live.dependencies.portal.capture = async () => {
  live.booleans['screenshot-write-clipboard'] = true;
  return uri;
};
await capture(live.dependencies);
assert(live.calls.includes('clipboard'), 'Policy changes while the portal is open must remain live, rather than snapshotted early');
