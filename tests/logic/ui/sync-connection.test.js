import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncConfigurationStore} from '../../../src/sync/configuration-store.js';
import {createConnectionActions, createRunner} from '../../../src/ui/settings/sync-connection.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const directory = GLib.dir_make_tmp('clipboard-x-gnome-connection-test-XXXXXX');
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
  profile = device, profileGate = null, channelGate = null, statusGate = null, saveGate = null} = {}) {
  const path = GLib.build_filenamev([directory, `${files.length}-connection.json`]);
  const progressPath = GLib.build_filenamev([directory, `${files.length}-progress.json`]);
  files.push(path, progressPath);
  const store = new SyncConfigurationStore({path});
  await store.saveConnection({
    serverAddress: 'saved.invalid:8765',
    apiKey: 'saved-test-key',
    activeChannelId: savedChannel,
  });
  GLib.file_set_contents(progressPath, 'unrelated progress data');
  const snapshot = JSON.stringify(store.current);
  const connectionDocument = contents(path);
  const progressDocument = contents(progressPath);
  const state = {saves: 0, revision: 17, reconnects: 0, transports: [], requests: [],
    profiles: [], events: []};
  const save = store.saveConnection.bind(store);
  store.saveConnection = value => {
    state.saves++;
    state.events.push('save');
    if (fail === 'save')
      throw new Error('local save failed');
    if (saveGate) {
      saveGate.entered();
      return saveGate.promise.then(() => save(value));
    }
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
          if (statusGate) {
            statusGate.entered();
            await statusGate.promise;
          }
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
  for (const {channels, selected} of [
    {channels: available, selected: draftChannel},
    {channels: [{id: fallbackChannel, name: 'Fallback channel'}, ...available], selected: draftChannel},
    {channels: [{id: fallbackChannel, name: 'Fallback channel'}], selected: fallbackChannel},
    {channels: [], selected: draftChannel},
  ]) {
    const reading = await fixture({channels});
    const current = {...draft, serverAddress: draft.serverAddress.trim(), apiKey: draft.apiKey.trim()};
    const snapshot = JSON.stringify(current);
    const result = await reading.actions.channels(current);
    assert(result.configuration.activeChannelId === selected && result.channels.length === channels.length
        && result.channels.every(value => value.active === (value.id === selected)),
      'Channel reads must retain an available selection, otherwise select the first channel or keep an empty list unchanged');
    assert(JSON.stringify(current) === snapshot && reading.state.requests.join() === 'channels',
      'Channel reads must not mutate their input or send write requests');
    reading.assertReadOnly();
    const probed = await reading.actions.test(draft);
    assert(probed.configuration.activeChannelId === selected,
      'Connection tests must use the same channel selection as direct reads');
    reading.assertReadOnly();
    const applied = await reading.actions.apply(draft);
    assert(!applied.error && applied.configuration.activeChannelId === selected
        && reading.store.current.activeChannelId === selected && reading.state.reconnects === 1
        && reading.state.saves === (selected === draftChannel ? 1 : 2),
      'Apply must persist the same channel selection and notify only once');
  }
  for (const options of [{fail: 'channels'}, {channels: [{id: 'invalid', name: 'Invalid channel'}]}]) {
    const reading = await fixture(options);
    let rejected = false;
    try {
      await reading.actions.channels({...draft,
        serverAddress: draft.serverAddress.trim(), apiKey: draft.apiKey.trim()});
    } catch (_error) {
      rejected = true;
    }
    assert(rejected, 'Failed channel reads or invalid channel lists must reject');
    reading.assertReadOnly();
  }

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
      && saved.activeChannelId === draftChannel && !Object.hasOwn(saved, 'cursors'),
    'Explicit saving must normalize connection inputs without exposing progress');
  const loaded = await apply.actions.channels(saved);
  assert(apply.state.saves === 1 && apply.state.revision === 18
      && apply.store.current.activeChannelId === draftChannel
      && loaded.configuration.activeChannelId === fallbackChannel && loaded.channels[0].active,
    'Loading channels must return a fallback selection without persisting or notifying');
  await apply.actions.save(loaded.configuration);
  assert(apply.state.saves === 2 && apply.state.revision === 19
      && apply.store.current.activeChannelId === fallbackChannel,
    'Channel-loading callers must explicitly save a fallback selection when persistence is intended');
  assert(apply.state.transports.every(transport => transport.aborted === 1),
    'normal channel loading must also release its temporary transport');

  const profileGate = gate();
  const channelGate = gate();
  const pending = await fixture({profileGate, channelGate,
    channels: [{id: fallbackChannel, name: 'Fallback channel'}]});
  const busyStates = [];
  const errors = [];
  const run = createRunner({
    setBusy: busy => busyStates.push(busy),
    onError: error => errors.push(error),
  });
  let finished = false;
  const applying = run(async () => {
    const value = await pending.actions.apply(draft);
    finished = true;
    return value;
  });
  await profileGate.started;
  assert(!finished && busyStates.join() === 'true',
    'The runner must stay busy while profile upload is pending');
  assert(pending.state.reconnects === 0 && pending.state.saves === 1,
    'Apply must persist locally but delay the Shell reconnect until the profile is confirmed');
  assert(pending.state.requests.join() === 'profile'
      && JSON.stringify(pending.state.profiles[0]) === JSON.stringify({tag: identity.deviceTag,
        iconKind: identity.deviceIconKind}),
    'Apply must immediately upload the current device tag and icon, without depending on Shell or sync-enabled');
  await run(() => pending.actions.apply(draft));
  assert(pending.state.saves === 1 && pending.state.profiles.length === 1,
    'Repeated Apply clicks during profile upload must not start another save or upload');
  profileGate.resolve();
  await channelGate.started;
  assert(!finished && pending.state.reconnects === 0
      && busyStates.join() === 'true',
    'Apply must also wait for channel loading before releasing the runner or reconnecting Shell');
  await run(() => pending.actions.apply(draft));
  assert(pending.state.transports.length === 1 && pending.state.profiles.length === 1,
    'A duplicate action during channel loading must not start another operation');
  channelGate.resolve();
  const applied = await applying;
  assert(!applied.error && applied.device.deviceId === deviceId
      && applied.configuration.activeChannelId === fallbackChannel && applied.channels[0].active,
    'Apply must return confirmed device information and persist the final channel selection');
  assert(finished && errors.length === 0 && busyStates.join() === 'true,false',
    'The runner must release its busy state only after the entire Apply finishes');
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
  assert(failedApply.error && busyStates.at(-1) === false,
    'Remote failure must release the runner so the user can retry');
  const unassigned = await fixture({channels: []});
  const newDevice = await unassigned.actions.apply({...draft, activeChannelId: ''});
  assert(!newDevice.error && newDevice.device.deviceId === deviceId && newDevice.channels.length === 0
      && newDevice.configuration.activeChannelId === '' && unassigned.state.profiles.length === 1,
    'A newly added device must upload its profile even before it has joined any channel');
  const invalid = await fixture();
  await run(() => invalid.actions.apply({...draft, apiKey: 'invalid\nkey'}));
  assert(errors.length === 1 && invalid.state.saves === 0 && invalid.state.reconnects === 0
      && busyStates.at(-1) === false,
    'Invalid inputs must not persist or reconnect and must release the runner');
  const localFailure = await fixture({fail: 'save'});
  const original = JSON.stringify(localFailure.store.current);
  await run(() => localFailure.actions.apply(draft));
  assert(errors.length === 2 && localFailure.state.reconnects === 0
      && localFailure.state.transports.length === 0
      && JSON.stringify(localFailure.store.current) === original && busyStates.at(-1) === false,
    'Local save failure must not upload or claim saved settings, and must release the runner for retry');
  for (const inputs of [{...draft, serverAddress: ''}, {...draft, apiKey: ''}]) {
    const cleared = await fixture();
    const result = await cleared.actions.apply(inputs);
    assert(!result.error && result.channels.length === 0 && cleared.state.transports.length === 0
        && cleared.state.reconnects === 1,
      'Clearing connection credentials must save locally without sending an unauthenticated profile');
  }

  const statusGate = gate();
  const closingTest = await fixture({statusGate});
  const lateTest = closingTest.actions.test(draft).catch(error => error);
  await statusGate.started;
  closingTest.actions.close();
  statusGate.resolve();
  const closedTestError = await lateTest;
  assert(closedTestError.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
      && closingTest.state.requests.join() === 'status',
    'Closing settings during status must cancel testing without starting the second channels request');
  closingTest.assertReadOnly();

  const closingProfileGate = gate();
  const closingApply = await fixture({profileGate: closingProfileGate});
  const lateApply = closingApply.actions.apply(draft);
  await closingProfileGate.started;
  closingApply.actions.close();
  closingProfileGate.resolve();
  const closedApply = await lateApply;
  assert(closedApply.error?.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)
      && closingApply.state.requests.join() === 'profile'
      && closingApply.state.saves === 1 && closingApply.state.reconnects === 1,
    'Closing during profile upload must stop channels while preserving the saved connection and its notification');
  assert(closingApply.store.current.serverAddress === 'draft.invalid:8765'
      && closingApply.state.transports.every(transport => transport.aborted === 1),
    'Closing must abort the active transport once without rolling back an accepted Apply');

  const saveGate = gate();
  const savingApply = await fixture({saveGate});
  const pendingSave = savingApply.actions.apply(draft);
  await saveGate.started;
  savingApply.actions.close();
  saveGate.resolve();
  const closedSave = await pendingSave;
  assert(closedSave.configuration.serverAddress === 'draft.invalid:8765'
      && savingApply.store.current.serverAddress === 'draft.invalid:8765'
      && savingApply.state.transports.length === 0 && savingApply.state.reconnects === 1,
    'Closing while an accepted local Apply saves must finish persistence and notify without starting HTTP');

  let active = true;
  const runnerGate = gate();
  const closedErrors = [];
  const closedBusy = [];
  const closedRunner = createRunner({isActive: () => active,
    setBusy: value => closedBusy.push(value), onError: error => closedErrors.push(error)});
  const lateRun = closedRunner(async () => { await runnerGate.promise; throw new Error('late failure'); });
  active = false;
  runnerGate.resolve();
  await lateRun;
  assert(closedErrors.length === 0 && closedBusy.join() === 'true',
    'A closed settings runner must not report late errors or update closed widgets');
} finally {
  for (const path of files) {
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null))
      file.delete(null);
  }
  Gio.File.new_for_path(directory).delete(null);
}
