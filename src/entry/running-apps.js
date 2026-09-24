import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {BUS_NAME, INTROSPECTION_XML, OBJECT_PATH, uniqueApplications} from '../common/running-apps.js';

export class RunningAppsBridge {
  start() {
    const host = {
      ListRunningApplications() {
        const tracker = Shell.WindowTracker.get_default();
        const applications = global.get_window_actors().map(actor => {
          const window = actor.meta_window;
          return {
            wmClass: window?.get_wm_class?.(),
            name: window ? tracker.get_window_app(window)?.get_name() : '',
          };
        });
        return uniqueApplications(applications).map(({name, wmClass}) => [name, wmClass]);
      },
    };
    this._exported = Gio.DBusExportedObject.wrapJSObject(INTROSPECTION_XML, host);
    this._exported.export(Gio.DBus.session, OBJECT_PATH);
    this._nameId = Gio.bus_own_name_on_connection(
      Gio.DBus.session, BUS_NAME, Gio.BusNameOwnerFlags.NONE, null, null);
  }

  stop() {
    this._exported?.unexport();
    this._exported = null;
    if (this._nameId)
      Gio.bus_unown_name(this._nameId);
    this._nameId = 0;
  }
}
