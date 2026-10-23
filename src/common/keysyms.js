// GDK and Clutter use the same XKB keysym values. Keep this mapping independent
// of either toolkit so preferences can record the keys that Shell matches.
const KEYPAD_KEYS = new Map([
  [0xff8d, 0xff0d], // KP_Enter -> Return
  [0xff9f, 0xffff], // KP_Delete -> Delete
  [0xff96, 0xff51], // KP_Left -> Left
  [0xff98, 0xff53], // KP_Right -> Right
  [0xff97, 0xff52], // KP_Up -> Up
  [0xff99, 0xff54], // KP_Down -> Down
]);

export function normalize(keyval) {
  return KEYPAD_KEYS.get(keyval) ?? keyval;
}
