import {assert} from '../helpers/checks.js';
import {runChecks} from '../helpers/run.js';

export async function layout(indicator) {
  const history = indicator._historyPanel;
  indicator._settings.set_strv('panel-toolbar-actions', [
    'color-picker', 'quick-phrases', 'screenshot',
  ]);
  indicator._settings.set_strv('panel-footer-actions', [
    'sync', 'private-mode', 'clear-history', 'preferences',
  ]);
  const footer = history.footer.contentActors.filter(actor => actor !== history.footerSpacer);
  assert(history.toolbar.get_children()[0] === history.colorButton
      && footer[0] === history.syncButton && footer[1] === history.privateButton,
    'Configured panel action order was not applied');
  indicator._settings.set_strv('panel-hidden-actions', ['screenshot', 'preferences']);
  assert(history.screenshotButton.get_parent() === null
      && history.preferencesButton.get_parent() === null
      && history.toolbar.get_children().length === 2,
    'Configured hidden panel icons remained visible');
}

export function run() {
  return runChecks([['layout', layout]]);
}
