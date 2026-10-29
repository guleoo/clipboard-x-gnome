import {InputError} from './errors.js';
import {textChunks} from './sequence.js';

// No Shell imports: this boundary owns text delivery policy, not GI resources.
// commit() only sends text; neither it nor this function acknowledges receipt.
export async function submit(text, {target, current, composing, active, commit, wait}) {
  if (!active())
    return;
  if (!target.focus)
    throw new InputError('text_unavailable');
  let sent = false;
  for (const chunk of textChunks(text)) {
    if (sent && !await wait(20))
      return;
    if (!active())
      return;
    const focus = current();
    if (focus.window !== target.window || focus.focus !== target.focus)
      throw new InputError('focus_changed');
    if (composing())
      throw new InputError('composition_active');
    commit(chunk);
    sent = true;
  }
}
