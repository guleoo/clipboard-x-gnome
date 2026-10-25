import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
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

const refreshButton = {type: 'GtkButton', tooltip: 'Refresh channels'};
async function connectionControls(preferences) {
  const selectors = [];
  // The preferences observer has one command slot, so observations must not
  // race each other when this process has not cached these translations yet.
  for (const selector of [button('Test connection'), button('Apply'), refreshButton])
    selectors.push(await preferences.translate(selector));
  const window = (await preferences.inspect()).windows.find(value => value.title === 'Clipboard X Gnome');
  const widgets = selectors.map(selector => window.widgets.find(widget => widget.mapped && widget.bounds
    && Object.entries(selector).every(([key, value]) => widget[key] === value)));
  assert(widgets.every(Boolean), 'All three actual connection buttons must exist');
  return {window, widgets};
}

async function clickInsensitiveControl(desktop, preferences, observed, widget) {
  const window = preferences.window('Clipboard X Gnome');
  const frame = window.get_frame_rect();
  const buffer = window.get_buffer_rect();
  const origin = Math.abs(buffer.width - observed.width) < Math.abs(frame.width - observed.width) ? buffer : frame;
  const bounds = widget.bounds;
  assert(bounds.y > 0 && bounds.y + bounds.height < observed.height,
    'Disabled-control clicks must target a visible native button, not clipped content');
  await desktop.pointClick(origin.x + bounds.x + bounds.width / 2, origin.y + bounds.y + bounds.height / 2);
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

  'CONN-03-refresh': desktop => fixture(desktop, async ({gate, preferences}) => {
    await preferences.input('Server address', gate.address);
    await preferences.scrollTo(button('Test connection'));
    await preferences.scrollTo(refreshButton);
    const activeControls = await connectionControls(preferences);
    assert(activeControls.widgets.every(widget => widget.hit && widget.sensitive),
      'All connection buttons must be exposed before the busy-state native clicks');
    const revision = desktop.settings.get_uint('sync-configuration-revision');
    gate.set({path: '/channels(?:\\?|$)', hold: true});
    await preferences.click(refreshButton);
    await until(() => gate.state.requests.some(value => value.stage === 'held'), 'real channel refresh is held');
    const saved = connectionFile();
    assert(JSON.parse(saved).serverAddress === gate.address
      && desktop.settings.get_uint('sync-configuration-revision') === revision + 1,
    'Refresh intentionally saves current connection inputs exactly once before requesting channels');
    const observed = await connectionControls(preferences);
    assert(observed.widgets.every(widget => !widget.sensitive),
      'Refresh must share the actual busy lock with Test and Apply');
    for (const widget of observed.widgets)
      await clickInsensitiveControl(desktop, preferences, observed.window, widget);
    assert(gate.state.requests.length === 1 && /\/channels(?:\?|$)/.test(gate.state.requests[0].path),
      'Native clicks on all busy actions must neither overlap Refresh nor start Test/profile Apply requests');
    assert(connectionFile() === saved && desktop.settings.get_uint('sync-configuration-revision') === revision + 1,
      'Blocked native actions must not save connection inputs again');
    gate.set({});
    await settled(preferences);
    assert(await hasStatus(preferences, 'Channels refreshed'), 'Completing the actual refresh releases controls with channel results');
    assert((await connectionControls(preferences)).widgets.every(widget => widget.sensitive),
      'All shared connection controls become usable after Refresh completes');
    assert(gate.state.requests.length === 1,
      'Disabled clicks must not leave delayed Test/Apply/Refresh requests after the first operation completes');

    // Close a different real in-flight Refresh. Its earlier local save is
    // intentional; late callbacks must not write anything else after closure.
    await preferences.scrollTo(refreshButton);
    const previousRequests = gate.state.requests.length;
    gate.set({path: '/channels(?:\\?|$)', hold: true});
    await preferences.click(refreshButton);
    await until(() => gate.state.requests.slice(previousRequests).some(value => value.stage === 'held'),
      'second real channel refresh pending before preferences close');
    const closingSaved = connectionFile();
    const closingRevision = desktop.settings.get_uint('sync-configuration-revision');
    assert(closingRevision === revision + 2, 'The second explicit Refresh saves only once');
    const process = preferences.process;
    let exited = false;
    const exit = new Promise((resolve, reject) => process.wait_async(null, (child, result) => {
      try { child.wait_finish(result); exited = true; resolve(); } catch (error) { reject(error); }
    }));
    // Do not use Preferences.close() here: its force-exit fallback could hide a
    // missing production close/cancellation path. The fixture still owns the
    // cleanup fallback if this assertion fails.
    preferences.window('Clipboard X Gnome').delete(global.get_current_time());
    await until(() => !preferences.window('Clipboard X Gnome'), 'native preferences window closed without forced process exit');
    gate.set({});
    await until(() => gate.state.requests.slice(previousRequests).every(value =>
      ['completed', 'disconnected'].includes(value.stage)), 'closed preferences request reaches a terminal gate state', 10000);
    await until(() => exited, 'preferences host exits naturally after native close', 10000);
    await exit;
    assert(process.get_successful(), 'Natural preferences shutdown must succeed');
    preferences.process = null;
    assert(connectionFile() === closingSaved && desktop.settings.get_uint('sync-configuration-revision') === closingRevision
      && !desktop.settings.get_boolean('sync-enabled'),
    'Closing pending Refresh must not allow late configuration writes or enable synchronization');
    await desktop.open();
    await desktop.key(Clutter.KEY_Right);
    assert(desktop.indicator.menu.isOpen, 'Closing a pending native Refresh must leave the Shell panel responsive');
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
