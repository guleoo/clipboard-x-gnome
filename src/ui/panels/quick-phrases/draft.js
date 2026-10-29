// Draft identity is independent of widgets and storage. A save may complete
// after edits, a form reopen, a newer submission or destruction.
export class Draft {
  constructor() {
    this.visible = false;
    this.text = '';
    this._revision = 0;
    this._request = 0;
    this._destroyed = false;
  }

  change(text) {
    this.text = text;
    this._revision++;
  }

  setVisible(visible) {
    this._revision++;
    this.visible = visible;
    this.text = '';
  }

  submit() {
    if (!this.text.trim())
      return null;
    return {text: this.text, revision: this._revision, request: ++this._request};
  }

  complete(submission) {
    if (this._destroyed || !this.visible || submission.revision !== this._revision
        || submission.request !== this._request)
      return false;
    this.setVisible(false);
    return true;
  }

  destroy() {
    this._destroyed = true;
  }
}
