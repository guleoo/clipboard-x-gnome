import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import {assert, pause, until} from '../helpers/desktop.js';
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

  'SET-06': desktop => fixture(desktop, async preferences => {
    await preferences.page('shortcuts');
    const {label: title} = await preferences.translate({label: 'Open clipboard panel'});
    const button = {type: 'GtkButton', row: 'Open clipboard panel'};
    const previous = desktop.settings.get_strv('panel-shortcut').join();
    await preferences.click(button);
    await until(() => preferences.window(title), 'real native shortcut recorder');
    await desktop.key(Clutter.KEY_Escape);
    await until(() => !preferences.window(title), 'Escape closes recorder');
    assert(desktop.settings.get_strv('panel-shortcut').join() === previous, 'Cancel must preserve existing shortcut');
    await preferences.click(button);
    await until(() => preferences.window(title), 'recorder reopened');
    await desktop.key(Clutter.KEY_F9, [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]);
    const expected = Meta.accelerator_name(Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.SHIFT_MASK, Clutter.KEY_F9);
    await until(() => desktop.settings.get_strv('panel-shortcut')[0] === expected,
      `actual combination recorded across GTK/Shell (${desktop.settings.get_strv('panel-shortcut')})`);
    await until(() => !preferences.window(title), 'saved recorder closes');
    await desktop.key(Clutter.KEY_F9, [Clutter.KEY_Control_L, Clutter.KEY_Shift_L]);
    await until(() => desktop.indicator.menu.isOpen, 'recorded shortcut actually rebinds the live Shell entry');
    await desktop.key(Clutter.KEY_Escape);
    await until(() => !desktop.indicator.menu.isOpen, 'return from rebound panel before clearing recorder');
    await preferences.click(button);
    await until(() => preferences.window(title), 'clear recorder');
    await desktop.key(Clutter.KEY_BackSpace);
    await until(() => desktop.settings.get_strv('panel-shortcut').length === 0, 'Backspace disables actual shortcut');
  }),

  'SET-08': desktop => fixture(desktop, async preferences => {
    desktop.settings.set_int('panel-width', 460);
    await desktop.phrases.replace(['Data survives native settings reset']);
    const identity = desktop.settings.get_string('device-id');
    const button = {type: 'GtkButton', label: 'Restore'};
    await preferences.scrollTo(button);
    await preferences.click(button);
    await pause(100);
    assert(desktop.settings.get_int('panel-width') === 460, 'First Restore only asks for confirmation');
    await desktop.key(Clutter.KEY_Escape);
    assert(desktop.settings.get_int('panel-width') === 460, 'Cancelling confirmation must preserve settings');
    await preferences.click(button);
    await pause(100);
    await preferences.click({type: 'GtkButton', label: 'Restore', row: ''});
    await until(() => desktop.settings.get_int('panel-width') === desktop.settings.get_default_value('panel-width').deepUnpack(),
      'native confirmation restores configured width');
    assert(desktop.settings.get_string('device-id') === identity
      && desktop.phrases.phrases.includes('Data survives native settings reset'),
    'Native reset must preserve device identity and phrase data');
    // The actual preferences bindings must remain usable after the reset.
    await preferences.page('general');
    await preferences.scrollTo({type: 'AdwSwitchRow', row: 'Show panel indicator'});
    await preferences.click({type: 'AdwSwitchRow', row: 'Show panel indicator'});
    await until(() => !desktop.settings.get_boolean('show-indicator'), 'preferences remains live after reset');
  }),
};
