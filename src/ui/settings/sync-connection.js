import {apiKey, serverAddress} from '../../sync/configuration.js';
import {channels as validateChannels, status as validateStatus} from '../../sync/protocol.js';

export function createConnectionActions({store, notifyChanged, createTransport, now}) {
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
  return {save, channels, test};
}
