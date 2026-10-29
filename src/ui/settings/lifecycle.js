// A closed GTK window can retain rooted children until finalization. Release
// settings resources on close, not during their eventual GC-time unroot.
export function onClosed(widget, callback) {
  let wasRooted = false;
  let closed = false;
  let window = null;
  let closeSignal = 0;
  let rootSignal = 0;
  const finish = () => {
    if (closed)
      return;
    closed = true;
    widget.disconnect(rootSignal);
    if (closeSignal)
      window.disconnect(closeSignal);
    closeSignal = 0;
    window = null;
    callback();
  };
  const rooted = () => {
    const root = widget.get_root();
    if (root) {
      wasRooted = true;
      if (root !== window) {
        if (closeSignal)
          window.disconnect(closeSignal);
        window = root;
        closeSignal = window.connect('close-request', () => {
          finish();
          return false;
        });
      }
      return;
    }
    if (wasRooted)
      finish();
  };
  rootSignal = widget.connect('notify::root', rooted);
  rooted();
  return finish;
}
