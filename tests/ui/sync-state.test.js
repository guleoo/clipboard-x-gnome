import {isComplete} from '../../src/ui/panels/history/sync-state.js';

function assert(value, message) {
  if (!value)
    throw new Error(message);
}

const preview = {remote: true, representations: [{bytes: null, path: null}]};
const received = {remote: true, representations: [{path: '/managed/original'}]};
assert(!isComplete(preview), 'Preview metadata alone must not show completion');
assert(!isComplete(preview, {state: 'completed'}),
  'Server preparation completion must not imply local download completion');
assert(isComplete(received), 'Received originals must show completion without transfer records');
assert(isComplete(received, {state: 'expired'}), 'Old transfer failures must not hide complete originals');
assert(isComplete({...received, representations: [{bytes: {}}]}), 'In-memory originals are complete');
assert(!isComplete({...received, representations: []}), 'Empty manifests must not count as complete');
assert(!isComplete({...received, representations: [...received.representations, {path: null}]}),
  'Mixed entries with a missing representation must remain incomplete');
assert(!isComplete({remote: false}), 'Local content must not imply successful publication');
assert(isComplete({remote: false}, {state: 'completed'}), 'Confirmed local publication is complete');
assert(!isComplete({remote: false}, {state: 'transferring'}), 'Local publication progress is not completion');
