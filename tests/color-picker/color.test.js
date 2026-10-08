import {formatColor, moveSample, parse, sampleRegion} from '../../src/color-picker/color.js';

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

assertEqual(formatColor([255, 0, 0], 'hex'), '#FF0000', 'HEX color format');
assertEqual(formatColor([255, 0, 0], 'rgb'), 'rgb(255, 0, 0)', 'RGB color format');
assertEqual(formatColor([255, 0, 0], 'hsl'), 'hsl(0 100% 50%)', 'HSL color format');
assertEqual(formatColor([255, 0, 0], 'oklch'), 'oklch(62.80% 0.2577 29.23)', 'OKLCH color format');
assertEqual(parse('#f00'), {red: 255, green: 0, blue: 0, alpha: 1}, 'short HEX color parsing');
assertEqual(parse('  #33669980  '), {
  red: 51,
  green: 102,
  blue: 153,
  alpha: 128 / 255,
}, 'HEX alpha color parsing');
assertEqual(parse('rgb(100% 0% 50% / 25%)'), {
  red: 255,
  green: 0,
  blue: 128,
  alpha: 0.25,
}, 'modern RGB color parsing');
assertEqual(parse('rgb(255, 0, 127)'), {
  red: 255,
  green: 0,
  blue: 127,
  alpha: 1,
}, 'legacy RGB color parsing');
assertEqual(parse('hsl(120 100% 25%)'), {
  red: 0,
  green: 128,
  blue: 0,
  alpha: 1,
}, 'HSL color parsing');
assertEqual(parse(formatColor([255, 0, 0], 'oklch')), {
  red: 255,
  green: 0,
  blue: 0,
  alpha: 1,
}, 'OKLCH color parsing');
assertEqual(parse('Use #ff0000 here'), null, 'embedded colors must not classify ordinary text');
assertEqual(parse('rgb(300, 0, 0)'), null, 'out-of-range color channels must be rejected');
assertEqual(parse('#12'), null, 'incomplete colors must be rejected');
assertEqual(sampleRegion(0, 0, 2, 200, 100, 5),
  {x: 0, y: 0, width: 6, height: 6, centerX: 0, centerY: 0},
  'magnifier region must clamp at the top-left texture edge');
assertEqual(sampleRegion(49.5, 24.5, 2, 100, 50, 5),
  {x: 94, y: 44, width: 6, height: 6, centerX: 5, centerY: 5},
  'magnifier coordinates must scale and clamp at the bottom-right edge');

for (const scale of [1, 1.25, 1.5, 2, 3]) {
  const width = 200;
  const height = 100;
  const origin = [20.3, 15.7];
  const pixel = coords => {
    const region = sampleRegion(...coords, scale, width, height);
    return [region.x + region.centerX, region.y + region.centerY];
  };
  const start = pixel(origin);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const next = moveSample(...origin, dx, dy, scale, width, height);
    assertEqual(pixel(next), [start[0] + dx, start[1] + dy],
      `one pixel cell per arrow at scale ${scale}`);
    assertEqual(pixel(moveSample(...next, -dx, -dy, scale, width, height)), start,
      `reversing movement restores the sampled pixel at scale ${scale}`);
    assertEqual(pixel(moveSample(...origin, dx * 8, dy * 8, scale, width, height)),
      [start[0] + dx * 8, start[1] + dy * 8],
      `Ctrl movement advances eight pixel cells at scale ${scale}`);
  }
  let coords = moveSample(...origin, 0, 0, scale, width, height);
  for (let i = 0; i < 20; i++)
    coords = moveSample(...coords, 1, 0, scale, width, height);
  assertEqual(pixel(coords), [start[0] + 20, start[1]],
    `repeated movement must not accumulate rounding errors at scale ${scale}`);
  assertEqual(pixel(moveSample(0, 0, -1, -1, scale, width, height)), [0, 0],
    `top and left texture edges clamp at scale ${scale}`);
  const edge = moveSample(1000, 1000, 0, 0, scale, width, height);
  assertEqual(edge, [(width - 1) / scale, (height - 1) / scale],
    `last physical pixel remains reachable at scale ${scale}`);
  assertEqual(pixel(moveSample(...edge, 1, 1, scale, width, height)), [width - 1, height - 1],
    `bottom and right texture edges clamp at scale ${scale}`);
}
