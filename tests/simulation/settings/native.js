import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import {assert, pause, until} from '../helpers/desktop.js';
import {Preferences} from '../helpers/preferences.js';
import {Target} from '../helpers/target.js';
import {capture} from '../clipboard/native.js';

async function fixture(desktop, run) {
  const preferences = await Preferences.open(desktop);
  try { await run(preferences); } finally { await preferences.close(); }
}

export const cases = {
  async 'SET-01-official'(desktop) {
    const windows = () => global.get_window_actors().map(actor => actor.meta_window);
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = new Set(windows());
      await desktop.open();
      await desktop.click(desktop.history.preferencesButton);
      let window;
      try {
        await until(() => {
          window = windows().find(candidate => !before.has(candidate)
            && candidate.get_title() === 'Clipboard X Gnome');
          return window;
        }, 'production preferences entry opens the official GNOME preferences host', 15000);
        assert(!desktop.indicator.menu.isOpen, 'Opening production preferences must close the panel');
        assert(window.get_gtk_application_id() !== 'io.github.guleoo.CbxSettingsAcceptance',
          'The real entry must not be satisfied by the test preferences fixture');
        assert(/org\.gnome\.Shell\.Extensions/i.test(window.get_wm_class() ?? ''),
          `Production preferences must belong to GNOME\u2019s host, not an error fixture (${window.get_wm_class()})`);
      } finally {
        window?.delete(global.get_current_time());
      }
      await until(() => !windows().includes(window), 'official preferences window closes before reopening');
    }
  },

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
    await desktop.key(Clutter.KEY_Control_L);
    assert(Boolean(preferences.window(title)) && desktop.settings.get_strv('panel-shortcut').join() === previous,
      'A modifier alone must leave the real recorder waiting without changing its binding');
    await desktop.key(Clutter.KEY_Left);
    const invalid = (await preferences.inspect()).windows.find(window => window.title === title);
    assert(invalid?.widgets.some(widget => widget.type === 'GtkImage' && widget.icon === 'dialog-warning-symbolic')
      && desktop.settings.get_strv('panel-shortcut').join() === previous,
    'An invalid unmodified navigation key must show native warning feedback without saving or closing');
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
    const target = await Target.open(desktop);
    let item;
    try { item = await capture(desktop, target, 'History survives the actual Restore confirmation'); }
    finally { await target.close(); }
    await desktop.app._controller.persist();
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
    assert(desktop.app._controller.items.some(value => value.id === item.id),
      'The actual Restore binding must preserve captured history');
    // The actual preferences bindings must remain usable after the reset.
    await preferences.page('general');
    await preferences.scrollTo({type: 'AdwSwitchRow', row: 'Show panel indicator'});
    await preferences.click({type: 'AdwSwitchRow', row: 'Show panel indicator'});
    await until(() => !desktop.settings.get_boolean('show-indicator'), 'preferences remains live after reset');
  }),
};
