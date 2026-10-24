import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import {UUID, STATUS_AREA_NAME, assert, waitUntil, fixturePath} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function colorsAndLifecycle(indicator, extensionObject) {
  const {ColorPicker} = await import(`${extensionObject.dir.get_uri()}/color-picker/picker.js`);
  const swatches = new St.BoxLayout({style: 'spacing: 0;'});
  swatches.add_child(new St.Widget({width: 80, height: 80, style: 'background-color: #ff0000;'}));
  swatches.add_child(new St.Widget({width: 80, height: 80, style: 'background-color: #0000ff;'}));
  swatches.set_position(200, 200);
  Main.layoutManager.addTopChrome(swatches);
  Main.overview.hide();
  indicator.menu.close();
  await Scripting.sleep(100);
  try {
    for (const mode of ['click', 'enter', 'space', 'escape', 'close', 'destroy']) {
      const selected = [];
      const picker = new ColorPicker(rgb => selected.push([...rgb]));
      let release;
      let pending;
      try {
        assert(await waitUntil(() => Boolean(picker._rgb) && !picker._sampling),
          `${mode}: color picker did not finish its initial sample`);
        const startX = 280 - 1 / picker._scale;
        await picker._sample(startX, 240);
        assert(JSON.stringify(picker._rgb) === '[255,0,0]', `${mode}: initial pixel must be red`);
        const capture = picker._captureSample.bind(picker);
        const gate = new Promise(resolve => { release = resolve; });
        picker._captureSample = async (...coords) => {
          await gate;
          return capture(...coords);
        };
        const key = symbol => picker.vfunc_key_press_event({
          get_key_symbol: () => symbol, get_state: () => 0,
        });
        // Arrow selection starts a sample before confirmation. Click must use
        // its own position even while that earlier sample is still pending.
        key(Clutter.KEY_Right);
        pending = picker._sampling;
        if (mode === 'click') {
          picker.vfunc_button_press_event({
            get_button: () => Clutter.BUTTON_PRIMARY, get_coords: () => [320, 240],
          });
        } else {
          key(mode === 'space' ? Clutter.KEY_space : Clutter.KEY_Return);
        }
        key(Clutter.KEY_Return);
        key(Clutter.KEY_space);
        picker.vfunc_button_press_event({
          get_button: () => Clutter.BUTTON_PRIMARY, get_coords: () => [240, 240],
        });
        picker.vfunc_motion_event({get_coords: () => [240, 240]});
        key(Clutter.KEY_Left);
        assert(selected.length === 0 && !picker._closed,
          `${mode}: confirmation must wait for its selected pixel`);
        if (mode === 'escape')
          key(Clutter.KEY_Escape);
        else if (mode === 'close')
          picker.close();
        else if (mode === 'destroy')
          picker.destroy();
        release();
        await pending;
        assert(await waitUntil(() => picker._closed), `${mode}: confirmation did not close the picker`);
        if (['escape', 'close', 'destroy'].includes(mode)) {
          assert(selected.length === 0, `${mode}: cancelled confirmation must not submit a color`);
        } else {
          assert(selected.length === 1 && JSON.stringify(selected[0]) === '[0,0,255]',
            `${mode}: confirmation must submit its blue target exactly once, not the old red pixel`);
        }
        assert(!picker._grab, `${mode}: picker must release its modal grab`);
      } finally {
        picker.close();
        release?.();
        await pending;
      }
    }
  } finally {
    Main.layoutManager.removeChrome(swatches);
    swatches.destroy();
  }
  const history = indicator._historyPanel;
  const deviceId = indicator._settings.get_string('device-id');
  assert(/^[0-9a-f-]{36}$/u.test(deviceId), 'Opening Clipboard X Gnome did not create a DeviceId');
  extensionObject._pickColor();
  await Scripting.sleep(500);
  assert(extensionObject._colorPicker, 'Color picker did not acquire a modal overlay');
  assert(extensionObject._colorPicker._rgb?.length === 3, 'Color picker did not sample the stage texture');
  const pickedColor = extensionObject._colorPicker;
  const [pickerX, pickerY] = pickedColor._coords;
  const pixelX = Math.round(pickerX * pickedColor._scale);
  const movementKey = pixelX < pickedColor._texture.get_width() - 1
    ? Clutter.KEY_Right : Clutter.KEY_Left;
  pickedColor.vfunc_key_press_event({
    get_key_symbol: () => movementKey,
    get_state: () => 0,
  });
  await Scripting.sleep(100);
  assert(Math.abs(Math.round(pickedColor._coords[0] * pickedColor._scale) - pixelX) === 1
      && pickedColor._coords[1] === pickerY,
    'Color picker keyboard movement did not advance by one screenshot pixel cell');
  pickedColor._onPicked(pickedColor._rgb);
  pickedColor.close();
  await Scripting.sleep(300);
  assert(!extensionObject._colorPicker, 'Color picker did not release its modal overlay');
  assert(extensionObject._colorPickerDestroySignal === 0,
    'Completed color picking retained the destroy signal ID');
  assert(indicator._controller.items.some(item => item.text.startsWith('#')),
    'Picked color did not enter clipboard history');
  const colorItem = indicator._controller.items.find(item => item.text.startsWith('#'));
  const colorRow = history.entry(colorItem);
  const colorContentBody = colorRow.focusActors[0].get_child();
  const colorSwatch = colorContentBody.get_children().find(child =>
    child.has_style_class_name?.('cbx-color-swatch'));
  assert(colorSwatch, 'Color clipboard content did not display a color swatch');
  colorRow.destroy();
  indicator._controller.toggleFavorite(colorItem.id);
  indicator._controller.clear();
  assert(indicator._controller.items.length === 1 && indicator._controller.items[0] === colorItem,
    'Clearing history did not preserve only favorited entries');

  extensionObject._pickColor();
  await Scripting.sleep(300);
  const cancelledPicker = extensionObject._colorPicker;
  cancelledPicker.vfunc_key_press_event({
    get_key_symbol: () => Clutter.KEY_Escape,
    get_state: () => 0,
  });
  await Scripting.sleep(100);
  assert(!extensionObject._colorPicker, 'Escape did not cancel and release the color picker');
  assert(extensionObject._colorPickerDestroySignal === 0,
    'Cancelled color picking retained the destroy signal ID');

  extensionObject._pickColor();
  await Scripting.sleep(300);
  assert(extensionObject._colorPicker, 'Color picker did not reopen for lifecycle testing');

  const oldController = extensionObject._controller;
  const oldSync = extensionObject._sync;
  Main.extensionManager.disableExtension(UUID);
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME], 'Indicator remained after disabling Clipboard X Gnome');
  assert(!extensionObject._colorPicker, 'Disabling Clipboard X Gnome did not close the active color picker');
  assert(extensionObject._colorPickerDestroySignal === 0,
    'Disabling Clipboard X Gnome did not clear the color picker destroy signal ID');
  assert(oldController._destroyed && oldController._selectionSignal === 0
      && oldController._settingsSignals.length === 0,
  'Disabling Clipboard X Gnome did not release clipboard and settings subscriptions');
  assert(oldSync._destroyed && oldSync._pollSource === 0 && !oldSync._transfers.current,
  'Disabling Clipboard X Gnome did not release synchronization polling, requests or transfer waiters');
  assert(!extensionObject._shortcutBound, 'Disabling Clipboard X Gnome did not remove its shortcut');

  Main.extensionManager.enableExtension(UUID);
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X Gnome did not recover after being enabled again');
  assert(indicator._settings.get_string('device-id') === deviceId,
    'DeviceId changed after the extension was disabled and enabled again');
  assert(indicator._controller.items.some(item => item.favorite && item.text === colorItem.text),
    'Favorited clipboard history did not survive extension restart');

  Main.sessionMode.pushMode('unlock-dialog');
  await Scripting.sleep(300);
  assert(!Main.panel.statusArea[STATUS_AREA_NAME],
    'Clipboard X Gnome remained active after the session entered its lock mode');
  Main.sessionMode.popMode('unlock-dialog');
  await Scripting.sleep(500);
  indicator = Main.panel.statusArea[STATUS_AREA_NAME];
  assert(indicator, 'Clipboard X Gnome did not recover after the session left its lock mode');
  assert(indicator._settings.get_string('device-id') === deviceId,
    'DeviceId changed across the lock/unlock lifecycle');

  Gio.Subprocess.new([
    '/usr/bin/python3',
    fixturePath('pause-process.py'),
    `${new Gio.Credentials().get_unix_pid()}`,
  ], Gio.SubprocessFlags.NONE);
  await Scripting.sleep(900);
  assert(Main.panel.statusArea[STATUS_AREA_NAME],
    'Clipboard X Gnome did not survive a nested Shell process suspend/resume cycle');
  St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'clipboard after simulated resume');
  await Scripting.sleep(400);
  assert(indicator._controller.items.some(item => item.text === 'clipboard after simulated resume'),
    'Clipboard capture did not recover after the simulated resume cycle');
}

export function run() {
  return runChecks([['colorsAndLifecycle', colorsAndLifecycle]]);
}
