import {Draft} from '../../../src/ui/panels/quick-phrases/draft.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const change of ['edit', 'edit-back', 'reopen']) {
  const draft = new Draft();
  draft.setVisible(true);
  draft.change(`Submitted phrase ${change}`);
  const original = draft.submit();
  assert(original.text === draft.text, 'Submission snapshots the exact submitted text');
  if (change === 'reopen') {
    draft.setVisible(false);
    draft.setVisible(true);
  }
  draft.change(`Newer draft ${change}`);
  if (change === 'edit-back') draft.change(original.text);
  const text = draft.text;
  assert(!draft.complete(original) && draft.visible && draft.text === text,
    `Completing an old submission must preserve a newer ${change} draft, even if its text matches again`);
}

for (const edit of [false, true]) {
  const draft = new Draft();
  draft.setVisible(true);
  draft.change('Overlapping submitted phrase');
  const first = draft.submit();
  if (edit) draft.change('Latest overlapping draft');
  const latest = draft.submit();
  const text = draft.text;
  assert(!draft.complete(first) && draft.visible && draft.text === text,
    'An earlier overlapping save must not close the latest submitted form');
  assert(draft.complete(latest) && !draft.visible && draft.text === '',
    'The latest unchanged successful save must close and clear its own form');
  assert(!draft.complete(latest), 'Repeated completion must not close a form a second time');
}

const failed = new Draft();
failed.setVisible(true);
failed.change('Draft retained after failed persistence');
const pending = failed.submit();
assert(failed.visible && failed.text === pending.text,
  'Beginning persistence must leave its draft intact when no successful completion arrives');
assert(failed.complete(failed.submit()) && !failed.visible, 'Retrying the same draft can complete normally');

const blank = new Draft();
blank.setVisible(true);
blank.change(' \t\n');
assert(blank.submit() === null && blank.visible && blank.text === ' \t\n',
  'An empty submission must not close or change its form');
const destroyed = new Draft();
destroyed.setVisible(true);
destroyed.change('Submitted before destroy');
const old = destroyed.submit();
destroyed.destroy();
assert(!destroyed.complete(old), 'Destruction must invalidate a successful late submission');
