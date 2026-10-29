// Word results arrive asynchronously. Only the newest request may update the
// panel, and only while its own loading state is still shown in an open popup.
export async function loadWords(item, panel) {
  let request = panel.nextRequest();
  let state = null;
  const current = () => request === panel.latestRequest() && panel.isOpen()
    && (!state || panel.shownState() === state);
  try {
    if (!item.isText)
      return;
    panel.validate(item);
    state = panel.showLoading(item);
    // Showing the panel invalidates older requests, including this serial.
    request = panel.latestRequest();
    await panel.waitForPaint();
    if (!current())
      return;
    await panel.readItem(item);
    if (!current())
      return;
    const source = item.text;
    panel.validate(item);
    const completed = await panel.createState(item, source);
    if (!current())
      return;
    Object.assign(state, completed);
    panel.refresh();
  } catch (error) {
    if (current()) {
      if (state)
        panel.reset();
      panel.reportError(error);
    }
  }
}
