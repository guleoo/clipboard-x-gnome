import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {assert, pause, until} from '../helpers/desktop.js';
import {Preferences} from '../helpers/preferences.js';
import {Server} from '../helpers/server.js';
import {Gate} from '../helpers/gate.js';
import {withCleanup} from '../helpers/resources.js';

async function fixture(desktop, run) {
  let server;
  let gate;
  let preferences;
  return withCleanup(async () => {
    server = await Server.open(desktop);
    gate = await Gate.open(server.address);
    preferences = await Preferences.open(desktop);
    await preferences.page('sync');
    await ready(preferences);
    await run({server, gate, preferences});
  }, () => [preferences, server, gate]);
}

const button = label => ({type: 'GtkButton', label});
async function hasStatus(preferences, prefix) {
  const translated = await preferences.translate({label: prefix});
  return (await status(preferences)).startsWith(translated.label);
}
async function ready(preferences) {
  const selector = await preferences.translate(button('Test connection'));
  const deadline = GLib.get_monotonic_time() + 30_000_000;
  while (GLib.get_monotonic_time() < deadline) {
    const snapshot = await preferences.inspect();
    if (snapshot.windows[0].widgets.some(value => value.type === selector.type && value.label === selector.label && value.sensitive)) {
      await preferences.scrollTo(button('Test connection'));
      return;
    }
    await pause(20);
  }
  throw new Error(`Connection controls must become available; status=${await status(preferences)}`);
}
async function status(preferences) {
  const selector = await preferences.translate({row: 'Server status'});
  const snapshot = await preferences.inspect();
  return snapshot.windows[0].widgets.find(widget => widget.type === 'AdwActionRow' && widget.row === selector.row)?.subtitle;
}
function connectionFile() {
  const [, bytes] = Gio.File.new_for_path(`${GLib.get_user_data_dir()}/clipboard-x-gnome/sync.json`).load_contents(null);
  return new TextDecoder().decode(bytes);
}
async function settled(preferences) {
  await pause(50);
  await ready(preferences);
}

export const cases = {
  'CONN-02': desktop => fixture(desktop, async ({gate, preferences}) => {
    const previous = connectionFile();
    const revision = desktop.settings.get_uint('sync-configuration-revision');
    await preferences.input('Server address', gate.address);
    gate.set({path: '/status', hold: true});
    await preferences.click(button('Test connection'));
    await until(() => gate.state.requests.some(value => value.stage === 'held'), 'actual unsaved status request held');
    assert(!await preferences.find(button('Test connection')) && !await preferences.find(button('Apply')),
      'All connection actions must be insensitive during the real request');
    gate.set({});
    await settled(preferences);
    assert(await hasStatus(preferences, 'Online'), 'Unsaved input must actually reach the selected server');
    assert(connectionFile() === previous && desktop.settings.get_uint('sync-configuration-revision') === revision
      && !desktop.settings.get_boolean('sync-enabled'), 'Testing inputs must not save or enable/restart synchronization');
  }),

  'CONN-03': desktop => fixture(desktop, async ({gate, preferences}) => {
    await preferences.input('Server address', gate.address);
    gate.set({path: '/status', hold: true});
    const found = await preferences.find(button('Test connection'));
    await preferences.click(button('Test connection'));
    await until(() => gate.state.requests.some(value => value.stage === 'held'), 'slow connection test pending');
    const frame = preferences.window('Clipboard X Gnome').get_frame_rect();
    for (let index = 0; index < 5; index++) await desktop.pointClick(
      frame.x + found.widget.bounds.x + found.widget.bounds.width / 2,
      frame.y + found.widget.bounds.y + found.widget.bounds.height / 2);
    assert(gate.state.requests.filter(value => value.path.endsWith('/status')).length === 1,
      'Repeated native clicks must not create concurrent tests');
    gate.set({});
    await settled(preferences);
    gate.set({path: '/status', hold: true});
    await preferences.click(button('Test connection'));
    await until(() => gate.state.requests.filter(value => value.stage === 'held').length === 1, 'second request pending');
    await preferences.close();
    gate.set({});
    await pause(200);
    await desktop.open();
    assert(desktop.indicator.menu.isOpen, 'Closing in-flight preferences must leave Shell and extension usable');
  }),

  'CONN-04': desktop => fixture(desktop, async ({server, gate, preferences}) => {
    await preferences.input('Device tag', 'Applied through real GTK');
    await preferences.input('Server address', gate.address.replace('http://', ''));
    gate.set({path: '/device/profile$', hold: true});
    await preferences.click(button('Apply'));
    await until(() => gate.state.requests.some(value => value.stage === 'held'), 'Apply waits for real device publication');
    assert(!await preferences.find(button('Apply')), 'Apply must remain disabled until device information is synchronized');
    gate.set({});
    await settled(preferences);
    const {devices} = await server.request('GET', '/devices');
    const device = devices.find(value => value.id === server.identity.id);
    assert(device.tag === 'Applied through real GTK'
      && device.iconKind === desktop.settings.get_string('device-icon-kind'),
    `Apply completes only after actual server profile update (tag=${JSON.stringify(device.tag)}, icon=${device.iconKind})`);
    const saved = JSON.parse(connectionFile());
    assert(saved.serverAddress === gate.address.replace('http://', '') && saved.activeChannelId === server.channel.id,
      'Bare IP input must persist as entered and reach the same normalized transport destination');
    assert(await hasStatus(preferences, 'Connection settings saved · API key configured'), 'Successful Apply must display actual completion');
  }),

  'CONN-05': desktop => fixture(desktop, async ({server, preferences}) => {
    await preferences.input('API key', 'invalid-synthetic-key');
    await preferences.click(button('Apply'));
    await settled(preferences);
    assert(JSON.parse(connectionFile()).apiKey === 'invalid-synthetic-key', 'Failed remote Apply must still report the actual locally saved input');
    assert(await hasStatus(preferences, 'Connection settings saved locally'), 'Remote failure must not masquerade as successful synchronization');
    await preferences.input('API key', server.identity.key);
    await preferences.click(button('Apply'));
    await settled(preferences);
    assert(await hasStatus(preferences, 'Connection settings saved · API key configured'), 'Failure must release controls and permit a successful native retry');
  }),
};
