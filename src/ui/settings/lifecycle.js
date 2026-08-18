// GTK settings widget lifecycle helpers.
export function disconnectWhenUnrooted(widget, callback) {
  let wasRooted = false;
  let disconnected = false;
  widget.connect('notify::root', () => {
    if (widget.get_root()) {
      wasRooted = true;
      return;
    }
    if (!wasRooted || disconnected)
      return;
    disconnected = true;
    callback();
  });
}
