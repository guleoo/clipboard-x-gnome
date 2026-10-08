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
    const current = await store.save(configuration(inputs));
    notifyChanged();
    return current;
  };
  const channels = async (current, {persistFallback = true} = {}) =>
    withTransport(current, async transport => {
      const result = validateChannels(await transport.channels(), current.activeChannelId);
      if (result.length > 0 && !result.some(item => item.id === current.activeChannelId)) {
        current = {...current, activeChannelId: result[0].id};
        if (persistFallback) {
          current = await store.save(current);
          notifyChanged();
        }
      }
      return {
        configuration: current,
        channels: result.map(item => ({...item, active: item.id === current.activeChannelId})),
      };
    });
  const test = async inputs => {
    const current = configuration(inputs);
    const started = now();
    const server = await withTransport(current, transport => transport.status());
    const status = validateStatus(server);
    const latency = Math.max(0, Math.round(now() - started));
    const result = await channels(current, {persistFallback: false});
    return {...result, status, latency};
  };
  const apply = async inputs => {
    const current = configuration(inputs);
    const profile = identity();
    // Keep connection changes locally even if the server cannot be reached.
    // Notify Shell only once, after profile upload and final channel selection.
    let saved = await store.save(current);
    try {
      if (!saved.serverAddress || !saved.apiKey)
        return {configuration: saved, channels: []};
      const result = await withTransport(saved, async transport => {
        const device = validateDevice(await transport.updateProfile({
          tag: profile.deviceTag,
          iconKind: profile.deviceIconKind,
        }), profile.deviceId);
        const values = validateChannels(await transport.channels(), saved.activeChannelId);
        const activeChannelId = values.some(value => value.id === saved.activeChannelId)
          ? saved.activeChannelId
          : values[0]?.id ?? saved.activeChannelId;
        return {device, activeChannelId, channels: values.map(value => ({
          ...value, active: value.id === activeChannelId,
        }))};
      });
      if (result.activeChannelId !== saved.activeChannelId)
        saved = await store.save({...saved, activeChannelId: result.activeChannelId});
      return {configuration: saved, channels: result.channels, device: result.device};
    } catch (error) {
      return {configuration: saved, error};
    } finally {
      notifyChanged();
    }
  };
  return {save, channels, test, apply};
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
