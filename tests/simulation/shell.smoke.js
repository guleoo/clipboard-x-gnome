import {runChecks} from './helpers/run.js';
import {phrases} from './phrases/integration.smoke.js';
import {layout} from './settings/layout.smoke.js';
import {status} from './sync/status.smoke.js';
import {historyEntries} from './clipboard/entries.smoke.js';
import {focusRestoration} from './panels/restoration.smoke.js';
import {wordSelection} from './word-selection/keyboard.smoke.js';
import {clippedWordSelection} from './word-selection/viewport.smoke.js';
import {clipboardSources} from './clipboard/capture.smoke.js';
import {images} from './clipboard/images.smoke.js';
import {receiving} from './sync/receive.smoke.js';
import {screenshots} from './screenshot/pipeline.smoke.js';
import {colorsAndLifecycle} from './color-picker/lifecycle.smoke.js';

export const METRICS = {};

export function run() {
  return runChecks([
    ['layout', layout],
    ['phrases', phrases],
    ['historyEntries', historyEntries],
    ['focusRestoration', focusRestoration],
    ['wordSelection', wordSelection],
    ['clippedWordSelection', clippedWordSelection],
    ['clipboardSources', clipboardSources],
    ['images', images],
    ['status', status],
    ['receiving', receiving],
    ['screenshots', screenshots],
    ['colorsAndLifecycle', colorsAndLifecycle],
  ]);
}
