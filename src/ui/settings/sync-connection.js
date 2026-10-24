import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {apiKey, serverAddress} from '../../sync/configuration.js';
import {channels as validateChannels, device as validateDevice, status as validateStatus} from '../../sync/protocol.js';

export function createConnectionActions({store, notifyChanged, createTransport, now, identity}) {
  let closed = false;
  const transports = new Set();
  const ensureOpen = () => {
    if (closed)
      throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Connection settings closed');
  };
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
    ensureOpen();
    const transport = createTransport(current);
    transports.add(transport);
    try {
      const result = await operation(transport);
      ensureOpen();
      return result;
    } finally {
      if (transports.delete(transport))
        transport.abort();
    }
  };
  const save = async inputs => {
    ensureOpen();
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
    ensureOpen();
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
        ensureOpen();
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
  const close = () => {
    closed = true;
    for (const transport of transports)
      transport.abort();
    transports.clear();
  };
  return {save, channels, test, apply, close};
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

export function createRunner({setBusy, onError, isActive = () => true}) {
  let busy = false;
  return async operation => {
    if (busy || !isActive())
      return;
    busy = true;
    setBusy(true);
    try {
      return await operation();
    } catch (error) {
      if (isActive())
        onError(error);
    } finally {
      busy = false;
      if (isActive())
        setBusy(false);
    }
  };
}
