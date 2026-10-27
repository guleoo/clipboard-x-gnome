import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, until} from '../helpers/desktop.js';

function modalState() {
  return {count: Main.modalCount, stack: [...Main.modalActorFocusStack], actionMode: Main.actionMode};
}

function released(picker, baseline) {
  assert(picker._closed && !picker._grab, 'A failed picker must close and release its modal handle');
  assert(!Main.layoutManager.uiGroup.get_children().includes(picker)
    && !Main.layoutManager._trackedActors.some(record => record.actor === picker),
  'A failed picker must be removed from both actual chrome children and tracked chrome');
  assert(Main.modalCount === baseline.count && Main.actionMode === baseline.actionMode
    && Main.modalActorFocusStack.length === baseline.stack.length
    && baseline.stack.every((record, index) => Main.modalActorFocusStack[index] === record),
  'A failed picker must restore the real modal count, stack and action mode');
  assert(global.stage.get_key_focus() !== picker, 'A failed picker must not retain stage keyboard focus');
}

async function reopen(desktop, baseline) {
  desktop.app._pickColor();
  const picker = desktop.app._colorPicker;
  assert(picker?._grab, 'After a failure a new real picker must acquire a modal grab');
  try {
    await until(() => picker._rgb && !picker._sampling, 'reopened picker finishes real screen sampling');
    await desktop.key(Clutter.KEY_Escape);
    await until(() => !desktop.app._colorPicker, 'reopened picker cancels through actual keyboard input');
    released(picker, baseline);
  } finally { picker.close(); }
}

export const cases = {
  async 'COLOR-06-initialize'(desktop) {
    await desktop.close();
    const {ColorPicker} = await import(`${desktop.app.dir.get_uri()}/color-picker/picker.js`);
    const initialize = ColorPicker.prototype._initialize;
    const baseline = modalState();
    const failure = new Error('Controlled color picker initialization failure');
    let picker;
    let submissions = 0;
    ColorPicker.prototype._initialize = async function () {
      picker = this;
      const picked = this._onPicked;
      this._onPicked = (...args) => { submissions++; return picked?.(...args); };
      throw failure;
    };
    try {
      desktop.app._pickColor();
      assert(picker && desktop.app._colorPicker === picker && picker._grab,
        'The failing initializer must run in the actual plugin picker after acquiring its real modal');
      await until(() => picker._closed && !desktop.app._colorPicker,
        'rejected initialization closes the picker and clears the plugin reference');
      assert(submissions === 0 && desktop.app._colorPickerDestroySignal === 0,
        'Rejected initialization must neither deliver a color nor retain its destroy subscription');
      released(picker, baseline);
      ColorPicker.prototype._initialize = initialize;
      await reopen(desktop, baseline);
    } finally {
      ColorPicker.prototype._initialize = initialize;
      picker?.close();
    }
  },

  async 'COLOR-06-grab'(desktop) {
    await desktop.close();
    const {ColorPicker} = await import(`${desktop.app.dir.get_uri()}/color-picker/picker.js`);
    const stage = global.stage;
    const ownGrab = Object.getOwnPropertyDescriptor(stage, 'grab');
    const grab = stage.grab;
    const baseline = modalState();
    const failure = new Error('Controlled color picker grab failure');
    let picker;
    let failures = 0;
    // Throw before Main.pushModal changes its stack. Returning null would make
    // Shell itself store an invalid grab, testing an artificial Main failure.
    stage.grab = function (actor, ...args) {
      if (!failures && actor instanceof ColorPicker) {
        failures++;
        picker = actor;
        throw failure;
      }
      return grab.call(this, actor, ...args);
    };
    const restore = () => {
      if (ownGrab) Object.defineProperty(stage, 'grab', ownGrab);
      else delete stage.grab;
    };
    try {
      let observed;
      try { desktop.app._pickColor(); } catch (error) { observed = error; }
      assert(failures === 1 && observed === failure,
        'The actual picker must encounter exactly the injected native-grab boundary failure');
      assert(!desktop.app._colorPicker && desktop.app._colorPickerDestroySignal === 0,
        'A failed constructor must not leave an active plugin picker or subscription');
      // Assert before fixture cleanup: a leaked overlay must fail, not be
      // silently repaired by this test's finally block.
      released(picker, baseline);
      restore();
      await reopen(desktop, baseline);
    } finally {
      restore();
      picker?.close();
    }
  },
};
