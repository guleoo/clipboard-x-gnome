const DIAGNOSTICS = {
  busy: 'An input operation is already running',
  target_unavailable: 'There is no target window for simulated input',
  text_unavailable: 'The target has no supported text-input focus',
  composition_active: 'The input method has an active composition',
  focus_changed: 'The input target changed during simulated input',
  invalid_text: 'The text contains a NUL or an unpaired surrogate',
};

export class InputError extends Error {
  constructor(code) {
    super(DIAGNOSTICS[code]);
    this.name = 'InputError';
    this.code = code;
  }
}

export function message(error, _) {
  if (!(error instanceof InputError))
    return '';
  switch (error.code) {
  case 'busy':
    return _('An input operation is already running.');
  case 'target_unavailable':
    return _('Focus a text field before starting input.');
  case 'text_unavailable':
    return _('Text submission is unavailable here. Focus a supported text field or choose Simulated keystrokes in Preferences.');
  case 'composition_active':
    return _('Finish or cancel the current input-method composition before starting input.');
  case 'focus_changed':
    return _('The target window or text field changed. Remaining input was cancelled.');
  case 'invalid_text':
    return _('This text contains characters that cannot be submitted.');
  default:
    return '';
  }
}
