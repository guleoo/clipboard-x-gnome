import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncConfigurationStore} from '../../src/sync/configuration-store.js';
import {createConnectionActions, createRunner} from '../../src/ui/settings/sync-connection.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const directory = GLib.dir_make_tmp('clipboard-x-connection-test-XXXXXX');
const files = [];
const savedChannel = '11111111-1111-4111-8111-111111111111';
const draftChannel = '22222222-2222-4222-8222-222222222222';
const fallbackChannel = '33333333-3333-4333-8333-333333333333';
const deviceId = '44444444-4444-4444-8444-444444444444';
const identity = {deviceId, deviceTag: 'Work laptop', deviceIconKind: 'archlinux'};
const device = {id: deviceId, tag: identity.deviceTag, iconKind: identity.deviceIconKind,
  state: 'online', lastSeenAt: 1};
const draft = {
  serverAddress: ' draft.invalid:8765 ',
  apiKey: ' draft-test-key ',
  activeChannelId: draftChannel,
};
const online = {apiVersion: 1, state: 'online', serverVersion: 'test-version'};
const available = [{id: draftChannel, name: 'Draft channel'}];

function contents(path) {
  const [success, bytes] = GLib.file_get_contents(path);
  assert(success, 'temporary configuration must be readable');
  return new TextDecoder().decode(bytes);
}

function gate() {
  let resolve;
  let entered;
  const promise = new Promise(yes => { resolve = yes; });
  const started = new Promise(yes => { entered = yes; });
  return {promise, resolve, started, entered};
}

async function fixture({status = online, channels = available, fail = '',
  profile = device, profileGate = null, channelGate = null} = {}) {
  const path = GLib.build_filenamev([directory, `${files.length}-connection.json`]);
  const progressPath = GLib.build_filenamev([directory, `${files.length}-progress.json`]);
  files.push(path, progressPath);
  const store = new SyncConfigurationStore({path, progressPath});
  await store.saveConnection({
    serverAddress: 'saved.invalid:8765',
    apiKey: 'saved-test-key',
    activeChannelId: savedChannel,
  });
  await store.saveProgress({cursors: {[savedChannel]: 'cursor-7'}, workCursor: 'work-4'});
  const snapshot = JSON.stringify(store.current);
  const connectionDocument = contents(path);
  const progressDocument = contents(progressPath);
  const state = {saves: 0, revision: 17, reconnects: 0, transports: [], requests: [],
    profiles: [], events: []};
  const save = store.save.bind(store);
  store.save = value => {
    state.saves++;
    state.events.push('save');
    if (fail === 'save')
      throw new Error('local save failed');
    return save(value);
  };
  let time = 10;
  const actions = createConnectionActions({
    store,
    notifyChanged: () => {
      state.revision++;
      state.reconnects++;
      state.events.push('notify');
    },
    identity: () => ({...identity}),
    now: () => {
      const value = time;
      time += 7;
      return value;
    },
    createTransport: configuration => {
      const transport = {
        configuration: {...configuration},
        aborted: 0,
        status: async () => {
          state.requests.push('status');
          if (fail === 'status')
            throw new Error('status failed');
          return status;
        },
        channels: async () => {
          state.requests.push('channels');
          if (channelGate) {
            channelGate.entered();
            await channelGate.promise;
          }
          if (fail === 'channels')
            throw new Error('channels failed');
          return channels;
        },
        updateProfile: async value => {
          state.requests.push('profile');
          state.profiles.push({...value});
          if (profileGate) {
            profileGate.entered();
            await profileGate.promise;
          }
          if (fail === 'profile')
            throw new Error('profile failed');
          state.events.push('profile-confirmed');
          return profile;
        },
        abort: () => {
          state.events.push('abort');
          transport.aborted++;
        },
      };
      state.transports.push(transport);
      return transport;
    },
  });
  const assertReadOnly = () => {
    assert(state.saves === 0, 'testing must not call store.save');
    assert(state.revision === 17 && state.reconnects === 0,
      'testing must not notify a revision change or trigger synchronization reconnect');
    assert(JSON.stringify(store.current) === snapshot, 'testing must not mutate store.current');
    assert(contents(path) === connectionDocument && contents(progressPath) === progressDocument,
      'testing must leave persisted connection and progress documents unchanged');
    assert(state.transports.every(transport => transport.aborted === 1),
      'all temporary transports must be aborted exactly once');
    assert(state.transports.every(transport =>
      transport.configuration.serverAddress === 'draft.invalid:8765'
        && transport.configuration.apiKey === 'draft-test-key'
        && transport.configuration.activeChannelId === draftChannel),
    'probe requests must use the current unapplied input, normalized like Apply');
  };
  return {store, state, actions, assertReadOnly};
}

try {
  const success = await fixture();
  const result = await success.actions.test(draft);
  assert(result.status.status === 'online' && result.status.implementationVersion === 'test-version'
      && result.latency === 7, 'testing must return validated status and status-request latency');
  assert(result.configuration.activeChannelId === draftChannel && result.channels[0].active,
    'an available draft channel must stay selected');
  assert(success.state.requests.join() === 'status,channels',
    'testing must only request status and channels');
  success.assertReadOnly();

  const missing = await fixture({channels: [{id: fallbackChannel, name: 'Fallback channel'}]});
  const fallback = await missing.actions.test(draft);
  assert(fallback.configuration.activeChannelId === fallbackChannel && fallback.channels[0].active,
    'a missing selected channel must fall back only in the returned UI draft');
  missing.assertReadOnly();
  await missing.actions.apply({...draft, activeChannelId: fallback.configuration.activeChannelId});
  assert(missing.state.saves === 1 && missing.state.revision === 18
      && missing.store.current.activeChannelId === fallbackChannel,
    'the probed fallback must only become persisted when the user applies the UI draft');

  const empty = await fixture({channels: []});
  const noChannels = await empty.actions.test(draft);
  assert(noChannels.channels.length === 0 && noChannels.configuration.activeChannelId === draftChannel,
    'an empty channel list must not replace the draft selection or save configuration');
  empty.assertReadOnly();

  for (const options of [
    {fail: 'status'},
    {fail: 'channels'},
    {status: {...online, apiVersion: 999}},
    {channels: [{id: 'invalid', name: 'Invalid channel'}]},
  ]) {
    const failure = await fixture(options);
    let rejected = false;
    try {
      await failure.actions.test(draft);
    } catch (_error) {
      rejected = true;
    }
    assert(rejected, 'failed or invalid probe responses must reject');
    assert(failure.state.requests.length === (options.fail === 'status' || options.status ? 1 : 2),
      'a failed status probe must not continue to channels');
    failure.assertReadOnly();
  }

  const apply = await fixture({channels: [{id: fallbackChannel, name: 'Fallback channel'}]});
  const saved = await apply.actions.save(draft);
  assert(apply.state.saves === 1 && apply.state.revision === 18 && apply.state.reconnects === 1,
    'Explicit saving must persist inputs and notify synchronization');
  assert(saved.serverAddress === 'draft.invalid:8765' && saved.apiKey === 'draft-test-key'
      && saved.activeChannelId === draftChannel && saved.cursors[savedChannel] === 'cursor-7',
    'Explicit saving must normalize inputs without losing progress');
  await apply.actions.channels(saved);
  assert(apply.state.saves === 2 && apply.state.revision === 19
      && apply.store.current.activeChannelId === fallbackChannel,
    'normal channel loading must retain its existing persisted fallback behavior');
  assert(apply.state.transports.every(transport => transport.aborted === 1),
    'normal channel loading must also release its temporary transport');

  const profileGate = gate();
  const channelGate = gate();
  const pending = await fixture({profileGate, channelGate,
    channels: [{id: fallbackChannel, name: 'Fallback channel'}]});
  const buttons = {apply: true, test: true, refresh: true};
  const busyStates = [];
  const errors = [];
  const run = createRunner({
    setBusy: busy => {
      busyStates.push(busy);
      for (const key of Object.keys(buttons))
        buttons[key] = !busy;
    },
    onError: error => errors.push(error),
  });
  let finished = false;
  const applying = run(async () => {
    const value = await pending.actions.apply(draft);
    finished = true;
    return value;
  });
  for (let index = 0; index < 10; index++)
    await run(() => pending.actions.apply(draft));
  await profileGate.started;
  assert(!finished && Object.values(buttons).every(value => !value),
    'Apply, Test and Refresh must stay disabled while profile upload is pending');
  assert(pending.state.reconnects === 0 && pending.state.saves === 1,
    'Apply must persist locally but delay the Shell reconnect until the profile is confirmed');
  assert(pending.state.requests.join() === 'profile'
      && JSON.stringify(pending.state.profiles[0]) === JSON.stringify({tag: identity.deviceTag,
        iconKind: identity.deviceIconKind}),
    'Apply must immediately upload the current device tag and icon, without depending on Shell or sync-enabled');
  for (let index = 0; index < 50; index++)
    await run(() => pending.actions.apply(draft));
  assert(pending.state.saves === 1 && pending.state.profiles.length === 1,
    'Repeated Apply clicks during profile upload must not start another save or upload');
  profileGate.resolve();
  await channelGate.started;
  assert(!finished && pending.state.reconnects === 0
      && Object.values(buttons).every(value => !value),
    'Apply must also wait for channel loading before enabling buttons or reconnecting Shell');
  for (let index = 0; index < 50; index++)
    await run(() => pending.actions.apply(draft));
  channelGate.resolve();
  const applied = await applying;
  assert(!applied.error && applied.device.deviceId === deviceId
      && applied.configuration.activeChannelId === fallbackChannel && applied.channels[0].active,
    'Apply must return confirmed device information and persist the final channel selection');
  assert(finished && errors.length === 0 && Object.values(buttons).every(Boolean)
      && busyStates.join() === 'true,false', 'Buttons must re-enable only after the entire Apply finishes');
  assert(pending.state.saves === 2 && pending.state.reconnects === 1 && pending.state.revision === 18
      && pending.state.events.at(-1) === 'notify',
    'Apply must notify Shell exactly once, after profile confirmation, session cleanup and fallback persistence');
  assert(pending.state.transports.length === 1 && pending.state.transports[0].aborted === 1,
    'Apply must share one temporary transport for profile and channels, then release it');
  const next = await run(() => pending.actions.apply(draft));
  assert(!next.error && pending.state.profiles.length === 2 && pending.state.reconnects === 2,
    'Apply must be available again after the previous operation has completed');

  for (const options of [
    {fail: 'profile'}, {fail: 'channels'},
    {profile: {...device, id: fallbackChannel}},
    {channels: [{id: 'invalid', name: 'Invalid channel'}]},
  ]) {
    const failed = await fixture(options);
    const result = await failed.actions.apply(draft);
    assert(result.error && result.configuration.serverAddress === 'draft.invalid:8765'
        && failed.store.current.apiKey === 'draft-test-key',
      'Profile or channel failure must be explicit while preserving locally saved connection settings');
    assert(failed.state.reconnects === 1 && failed.state.transports.every(value => value.aborted === 1),
      'Failed Apply must release its transport and notify Shell only once');
    if (options.fail === 'profile' || options.profile)
      assert(failed.state.requests.join() === 'profile', 'Unconfirmed device profiles must not continue to channels');
  }

  const failure = await fixture({fail: 'profile'});
  const failedApply = await run(() => failure.actions.apply(draft));
  assert(failedApply.error && Object.values(buttons).every(Boolean),
    'Remote failure must restore buttons so the user can retry');
  const unassigned = await fixture({channels: []});
  const newDevice = await unassigned.actions.apply({...draft, activeChannelId: ''});
  assert(!newDevice.error && newDevice.device.deviceId === deviceId && newDevice.channels.length === 0
      && newDevice.configuration.activeChannelId === '' && unassigned.state.profiles.length === 1,
    'A newly added device must upload its profile even before it has joined any channel');
  const invalid = await fixture();
  await run(() => invalid.actions.apply({...draft, apiKey: 'invalid\nkey'}));
  assert(errors.length === 1 && invalid.state.saves === 0 && invalid.state.reconnects === 0
      && Object.values(buttons).every(Boolean),
    'Invalid inputs must not persist or reconnect and must restore the button gate');
  const localFailure = await fixture({fail: 'save'});
  const original = JSON.stringify(localFailure.store.current);
  await run(() => localFailure.actions.apply(draft));
  assert(errors.length === 2 && localFailure.state.reconnects === 0
      && localFailure.state.transports.length === 0
      && JSON.stringify(localFailure.store.current) === original && Object.values(buttons).every(Boolean),
    'Local save failure must not upload or claim saved settings, and must unlock buttons for retry');
  for (const inputs of [{...draft, serverAddress: ''}, {...draft, apiKey: ''}]) {
    const cleared = await fixture();
    const result = await cleared.actions.apply(inputs);
    assert(!result.error && result.channels.length === 0 && cleared.state.transports.length === 0
        && cleared.state.reconnects === 1,
      'Clearing connection credentials must save locally without sending an unauthenticated profile');
  }
} finally {
  for (const path of files) {
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null))
      file.delete(null);
  }
  Gio.File.new_for_path(directory).delete(null);
}
