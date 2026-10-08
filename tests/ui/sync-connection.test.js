import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {SyncConfigurationStore} from '../../src/sync/configuration-store.js';
import {createConnectionActions} from '../../src/ui/settings/sync-connection.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

const directory = GLib.dir_make_tmp('clipboard-x-connection-test-XXXXXX');
const files = [];
const savedChannel = '11111111-1111-4111-8111-111111111111';
const draftChannel = '22222222-2222-4222-8222-222222222222';
const fallbackChannel = '33333333-3333-4333-8333-333333333333';
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

async function fixture({status = online, channels = available, fail = ''} = {}) {
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
  const state = {saves: 0, revision: 17, reconnects: 0, transports: [], requests: []};
  const save = store.save.bind(store);
  store.save = value => {
    state.saves++;
    return save(value);
  };
  let time = 10;
  const actions = createConnectionActions({
    store,
    notifyChanged: () => {
      state.revision++;
      state.reconnects++;
    },
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
          if (fail === 'channels')
            throw new Error('channels failed');
          return channels;
        },
        abort: () => transport.aborted++,
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
  await missing.actions.save({...draft, activeChannelId: fallback.configuration.activeChannelId});
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
    'Apply must continue saving inputs and notifying synchronization');
  assert(saved.serverAddress === 'draft.invalid:8765' && saved.apiKey === 'draft-test-key'
      && saved.activeChannelId === draftChannel && saved.cursors[savedChannel] === 'cursor-7',
    'Apply must save normalized inputs without losing progress');
  await apply.actions.channels(saved);
  assert(apply.state.saves === 2 && apply.state.revision === 19
      && apply.store.current.activeChannelId === fallbackChannel,
    'normal channel loading must retain its existing persisted fallback behavior');
  assert(apply.state.transports.every(transport => transport.aborted === 1),
    'normal channel loading must also release its temporary transport');
} finally {
  for (const path of files) {
    const file = Gio.File.new_for_path(path);
    if (file.query_exists(null))
      file.delete(null);
  }
  Gio.File.new_for_path(directory).delete(null);
}
