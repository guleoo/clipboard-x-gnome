import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, until, rect} from './session.js';

export async function entrance(s) {
  await s.click(s.indicator);
  await until(() => s.indicator.menu.isOpen, 'topbar opens');
  await s.settle();
  await s.click(s.indicator);
  await until(() => !s.indicator.menu.actor.visible, 'second topbar click closes');
  await s.open();
  await s.shortcut();
  await until(() => !s.indicator.menu.actor.visible, 'second shortcut closes');
  await s.open();
  await s.pointClick(40, global.stage.height - 40);
  await until(() => !s.indicator.menu.actor.visible, 'desktop click closes');
}

export async function anchors(s) {
  s.settings.set_boolean('show-indicator', false);
  assert(!s.indicator.visible, 'Topbar indicator must be hidden');
  const cases = [];
  for (const anchor of ['top-left', 'top-center', 'top-right', 'center-left', 'center',
    'center-right', 'bottom-left', 'bottom-center', 'bottom-right'])
    for (const offset of [-18, 0, 18]) cases.push([anchor, offset, offset]);
  for (const anchor of ['center', 'bottom-right'])
    for (const [x, y] of [[-4096, -4096], [4096, 4096], [-4096, 4096], [4096, -4096]])
      cases.push([anchor, x, y]);
  for (const [anchor, x, y] of cases) {
    s.settings.set_string('panel-anchor', anchor);
    s.settings.set_int('panel-offset-x', x);
    s.settings.set_int('panel-offset-y', y);
    await s.open();
    assert(s.indicator.menu.sourceActor === s.indicator._menuAnchor, 'Hidden entry must use configured anchor');
    const area = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.currentMonitor.index);
    const box = rect(s.indicator.menu.actor);
    assert(box.x >= area.x - 2 && box.y >= area.y - 2
      && box.x + box.width <= area.x + area.width + 2 && box.y + box.height <= area.y + area.height + 2,
    `${anchor}/${x}/${y}: popup outside workarea (${box.x},${box.y},${box.width},${box.height})`);
  }
  print(`[panels] anchor cases: ${cases.length}`);
}

export async function geometry(s) {
  await s.open();
  const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
  for (const [width, height] of [[360, 400], [300, 160], [480, 500], [800, 800]]) {
    s.settings.set_int('panel-width', width);
    s.settings.set_int('panel-height', height);
    for (const name of ['history', 'tokenizer', 'phrases']) {
      await s.show(name);
      const actor = name === 'history' ? s.history.actor : name === 'tokenizer' ? s.words.actor : s.phrases.actor;
      await until(() => Math.abs(s.indicator.menu.actor.width - width * scale) <= 2
        && Math.abs(actor.height - height * scale) <= 2, `${name} applies ${width}x${height}`);
    }
  }
  const lifecycle = s.manager._panels.get('phrases');
  lifecycle.geometry = {width: 420, height: 260};
  try {
    s.manager.setGeometry({width: 480, height: 500});
    await s.show('phrases');
    await until(() => s.indicator.menu.actor.width === 420 * scale && s.phrases.actor.height === 260 * scale,
      'per-panel geometry override');
    await s.show('history');
    await until(() => s.indicator.menu.actor.width === 480 * scale && s.history.actor.height === 500 * scale,
      'override does not affect history');
  } finally {
    delete lifecycle.geometry;
    s.manager.setGeometry({width: 360, height: 400});
  }
}

export async function scene(s) {
  assert(St.Settings.get().enable_animations, 'This check requires real Shell animations');
  for (const preserve of [false, true]) {
    s.settings.set_boolean('preserve-panel-state', preserve);
    for (const name of ['phrases', 'tokenizer']) {
      s.manager.reset();
      await s.open();
      if (name === 'phrases') {
        await s.click(s.history.phrasesButton);
        await until(() => s.manager.is('phrases'), 'phrases opened');
        await s.settle();
        if (s.phrases.formVisible) s.phrases.hideForm();
        await s.click(s.phrases.addButton);
        await until(() => s.focus === s.phrases.entry.clutter_text, 'draft focused');
        await s.type('ab');
      } else {
        await s.openWords();
        await s.key(Clutter.KEY_Right);
        await s.key(Clutter.KEY_space);
      }
      const selected = name === 'tokenizer' ? s.words.state.selected.size : null;
      const frames = [];
      const visibility = [];
      const historySignal = s.history.item.connect('notify::visible', () => {
        if (s.history.item.visible)
          visibility.push(!s.indicator.menu.actor.visible || s.indicator.menu.actor.opacity === 0);
      });
      const paintSignal = global.stage.connect('after-paint', () => {
        if (s.indicator.menu.actor.visible && s.indicator.menu.actor.opacity > 0)
          frames.push({opacity: s.indicator.menu.actor.opacity, panel: s.manager.currentName, history: s.history.item.visible});
      });
      try {
        await s.pointClick(40, global.stage.height - 40);
        await until(() => !s.indicator.menu.actor.visible, 'animated close completed');
      } finally {
        global.stage.disconnect(paintSignal);
        s.history.item.disconnect(historySignal);
      }
      assert(frames.some(frame => frame.opacity > 0 && frame.opacity < 255), 'No actual close-animation frame sampled');
      assert(frames.every(frame => frame.panel === name && !frame.history)
        && visibility.every(Boolean), 'Closing secondary panel flashed history');
      await s.shortcut();
      await until(() => s.indicator.menu.isOpen, 'reopened');
      await s.settle();
      assert(s.manager.is(preserve ? name : 'history'), 'Reopen must follow scene-retention setting');
      if (preserve && name === 'phrases')
        assert(s.phrases.formVisible && s.phrases.entry.get_text() === 'ab', 'Draft was not retained');
      if (preserve && name === 'tokenizer')
        assert(selected > 0 && s.words.state.selected.size === selected, 'Word selection was not retained');
      // Reopen before the old close animation completes; do not wait for hidden.
      await s.pointClick(40, global.stage.height - 40);
      await s.shortcut();
      await until(() => s.indicator.menu.isOpen, 'rapid reopen');
      await s.settle();
      assert(s.indicator.menu.actor.visible && s.manager.is(preserve ? name : 'history'), 'Old close completion undid rapid reopen');
      await s.close();
    }
  }
}

export async function returnToHistory(s) {
  await s.open();
  await s.type('Panel fixture');
  await until(() => s.history._query === 'Panel fixture' && s.history._itemRows.size === 35, 'search fixture rendered');
  for (let index = 0; index < 11; index++) await s.key(Clutter.KEY_Down);
  await s.key(Clutter.KEY_Right);
  await s.settle();
  const before = s.history.captureView();
  assert(before.itemId === s.fixture[10].id && before.action === 'tokenize' && before.scrollValue > 0,
    'Navigation must reach the eleventh item, not merely any scrolled row');
  await s.key(Clutter.KEY_Return);
  await until(() => s.manager.is('tokenizer'), 'word selection opened from eleventh item');
  await s.settle();
  await s.click(s.words.backButton);
  await until(() => s.manager.is('history'), 'returned to history');
  await s.settle();
  const after = s.history.captureView();
  assert(s.history._query === 'Panel fixture' && after.itemId === before.itemId
    && after.action === before.action && Math.abs(after.scrollValue - before.scrollValue) < 2,
  'Return must retain search, eleventh item, action and scroll offset');
}
