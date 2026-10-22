import {apiKey, serverAddress} from '../../sync/configuration.js';
import {channels as validateChannels, device as validateDevice, status as validateStatus} from '../../sync/protocol.js';

export function createConnectionActions({store, notifyChanged, createTransport, now, identity}) {
  const configuration = inputs => {
    const address = String(inputs.serverAddress ?? '').trim();
    return {
      ...store.current,
      ...inputs,
      serverAddress: address ? serverAddress(address) : '',
      apiKey: apiKey(inputs.apiKey, {allowEmpty: true}),
    };
  };
  const withTransport = async (current, operation) => {
    const transport = createTransport(current);
    try {
      return await operation(transport);
    } finally {
      transport.abort();
    }
  };
  const save = async inputs => {
    const current = await store.saveConnection(configuration(inputs));
    notifyChanged();
    return current;
  };
  const channels = current => withTransport(current, async transport =>
    selectChannels(current, await transport.channels()));
  const test = async inputs => {
    const current = configuration(inputs);
    const started = now();
    const server = await withTransport(current, transport => transport.status());
    const status = validateStatus(server);
    const latency = Math.max(0, Math.round(now() - started));
    const result = await channels(current);
    return {...result, status, latency};
  };
  const apply = async inputs => {
    const current = configuration(inputs);
    const profile = identity();
    // Keep connection changes locally even if the server cannot be reached.
    // Notify Shell only once, after profile upload and final channel selection.
    let saved = await store.saveConnection(current);
    try {
      if (!saved.serverAddress || !saved.apiKey)
        return {configuration: saved, channels: []};
      const result = await withTransport(saved, async transport => {
        const device = validateDevice(await transport.updateProfile({
          tag: profile.deviceTag,
          iconKind: profile.deviceIconKind,
        }), profile.deviceId);
        return {device, ...selectChannels(saved, await transport.channels())};
      });
      if (result.configuration.activeChannelId !== saved.activeChannelId)
        saved = await store.saveConnection(result.configuration);
      return {configuration: saved, channels: result.channels, device: result.device};
    } catch (error) {
      return {configuration: saved, error};
    } finally {
      notifyChanged();
    }
  };
  return {save, channels, test, apply};
}

function selectChannels(current, rawValue) {
  const values = validateChannels(rawValue, current.activeChannelId);
  const activeChannelId = values.some(value => value.id === current.activeChannelId)
    ? current.activeChannelId
    : values[0]?.id ?? current.activeChannelId;
  return {
    configuration: {...current, activeChannelId},
    channels: values.map(value => ({...value, active: value.id === activeChannelId})),
  };
}

export function createRunner({setBusy, onError}) {
  let busy = false;
  return async operation => {
    if (busy)
      return;
    busy = true;
    setBusy(true);
    try {
      return await operation();
    } catch (error) {
      onError(error);
    } finally {
      busy = false;
      setBusy(false);
    }
  };
}
