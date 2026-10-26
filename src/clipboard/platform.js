import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

// Keep compositor bindings at the platform boundary. The controller owns every
// signal, transfer scope and persistence operation, rather than the adapter.
export function createPlatform() {
  return {
    clipboard: St.Clipboard.get_default(),
    clipboardType: St.ClipboardType.CLIPBOARD,
    get selection() { return Shell.Global.get().display.get_selection(); },
    selectionType: Meta.SelectionType.SELECTION_CLIPBOARD,
    focusedApp: () => Shell.Global.get().display.focusWindow?.get_wm_class?.() ?? null,
  };
}
