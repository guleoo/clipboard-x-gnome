import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'clipboard-x@guleoo.github.io';
const BUS_NAME = 'org.gnome.Shell.Extensions.ClipboardX';
const OBJECT_PATH = '/org/gnome/Shell/Extensions/ClipboardX';

export const METRICS = {};

export async function run() {
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;
  const extension = Main.extensionManager.lookup(UUID);
  if (!extension?.enabled)
    throw new Error('Clipboard X extension must be enabled');
  await Scripting.sleep(200);
  const result = await new Promise((resolve, reject) => {
    Gio.DBus.session.call(
      BUS_NAME, OBJECT_PATH, BUS_NAME, 'ListRunningApplications', null,
      null, Gio.DBusCallFlags.NONE, 3000, null,
      (connection, callback) => {
        try {
          resolve(connection.call_finish(callback).deepUnpack()[0]);
        } catch (error) {
          reject(error);
        }
      },
    );
  });
  if (!Array.isArray(result) || result.some(entry => !Array.isArray(entry)
      || entry.length !== 2 || !entry[1]))
    throw new Error('Running application bridge returned an invalid window-class list');
}
