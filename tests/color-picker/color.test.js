import {formatColor, sampleRegion} from '../../src/color-picker/color.js';

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

assertEqual(formatColor([255, 0, 0], 'hex'), '#FF0000', 'HEX color format');
assertEqual(formatColor([255, 0, 0], 'rgb'), 'rgb(255, 0, 0)', 'RGB color format');
assertEqual(formatColor([255, 0, 0], 'hsl'), 'hsl(0 100% 50%)', 'HSL color format');
assertEqual(formatColor([255, 0, 0], 'oklch'), 'oklch(62.80% 0.2577 29.23)', 'OKLCH color format');
assertEqual(sampleRegion(0, 0, 2, 200, 100, 5),
  {x: 0, y: 0, width: 6, height: 6, centerX: 0, centerY: 0},
  'magnifier region must clamp at the top-left texture edge');
assertEqual(sampleRegion(49.5, 24.5, 2, 100, 50, 5),
  {x: 94, y: 44, width: 6, height: 6, centerX: 5, centerY: 5},
  'magnifier coordinates must scale and clamp at the bottom-right edge');
