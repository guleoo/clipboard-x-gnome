import {isComplete, isPreviewPublished} from '../../src/ui/panels/history/sync-state.js';

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

const publication = {kind: 'publish', direction: 'upload', state: 'completed'};
const local = {remote: false, representations: [{delivery: 'eager'}]};
assert(!isPreviewPublished(local, publication), 'Eager publication must keep the full completion icon');
for (const mimeType of ['text/plain;charset=utf-8', 'image/png']) {
  const lazy = {...local, representations: [{mimeType, delivery: 'on-demand'}]};
  assert(isPreviewPublished(lazy, publication), `${mimeType} lazy publication must use the preview icon`);
  for (const state of ['transferring', 'failed', 'cancelled', 'expired']) {
    assert(!isPreviewPublished(lazy, {...publication, state}),
      `${state} publication must not look like a synchronized preview`);
  }
  assert(!isPreviewPublished(lazy), 'Unpublished lazy content must not show a completion icon');
  assert(!isPreviewPublished(lazy, {...publication, kind: 'content'}),
    'An original upload completion must not be mistaken for preview publication');
  assert(!isPreviewPublished({...lazy, remote: true}, publication),
    'Remote previews must keep their download action');
  assert(!isPreviewPublished({...lazy, remote: true, representations: [{...lazy.representations[0], path: '/managed/original'}]}, publication),
    'Downloaded originals must keep the full completion icon even with on-demand delivery');
}
assert(isPreviewPublished({...local, representations: [{delivery: 'eager'}, {delivery: 'on-demand'}]}, publication),
  'A publication with any lazy representation must not imply that every original was uploaded');
