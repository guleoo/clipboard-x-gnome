import {assert} from '../helpers/desktop.js';
import {Preferences} from '../helpers/preferences.js';

async function fixture(desktop, run) {
  const preferences = await Preferences.open(desktop);
  try { await run(preferences); } finally { await preferences.close(); }
}

export const cases = {
  'SET-01': desktop => fixture(desktop, async preferences => {
    for (const page of ['clipboard', 'quick-phrases', 'sync', 'color-picker', 'screenshot', 'shortcuts', 'about', 'general'])
      await preferences.page(page);
    const snapshot = await preferences.inspect();
    assert(snapshot.windows.length === 1 && snapshot.windows[0].title === 'Clipboard X Gnome',
      'Every production preferences page must construct without an extension-error window');
  }),
};
