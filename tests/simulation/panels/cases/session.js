import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {Desktop} from '../../helpers/desktop.js';
export {UUID, pause, init, assert, until, rect, inside} from '../../helpers/desktop.js';

export class Session extends Desktop {
  get tag() { return 'panels'; }

  async seed() {
    const {ClipboardItem} = await import(`${this.app.dir.get_uri()}/clipboard/item.js`);
    for (const item of [...this.app._controller.items]) this.app._controller.remove(item.id);
    for (let index = 34; index >= 0; index--)
      this.app._controller.add(ClipboardItem.fromText(
        `Panel fixture ${String(index).padStart(2, '0')} alpha beta gamma delta epsilon zeta eta theta iota kappa lambda`));
    this.fixture = [...this.app._controller.items];
    await this.app._controller.persist();
    await this.phrases.replace(['First quick phrase', 'Second quick phrase', 'Third quick phrase']);
  }

  async reset() {
    await this.close();
    for (const [key, value] of this.defaults)
      if (key !== 'panel-shortcut') this.settings.set_value(key, value);
    this.settings.set_strv('panel-shortcut', ['<Control><Shift>F8']);
    this.settings.set_boolean('sync-enabled', false);
    this.settings.set_int('panel-visible-item-limit', 50);
    this.settings.set_boolean('show-indicator', true);
    this.settings.set_boolean('panel-confine-focus', true);
    this.settings.set_boolean('preserve-panel-state', false);
    this.settings.set_int('panel-width', 360);
    this.settings.set_int('panel-height', 400);
    this.phrases.hideForm();
    this.manager.reset();
    this.history.resetSearch();
    await this.phrases.replace(['First quick phrase', 'Second quick phrase', 'Third quick phrase']);
    await this.move(global.stage.width / 2, global.stage.height - 50);
    await Scripting.waitLeisure();
  }

}
