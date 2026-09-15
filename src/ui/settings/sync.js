import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {SyncConfigurationStore} from '../../sync/configuration-store.js';
import {message as syncErrorMessage} from '../../sync/errors.js';
import {HttpTransport} from '../../sync/http/transport.js';
import {channels as validateChannels, status as validateStatus} from '../../sync/protocol.js';

export function create(settings, deviceId, rows) {
  const store = new SyncConfigurationStore();
  const group = new Adw.PreferencesGroup({title: _('Server connection')});
  group.add(rows.switch('sync-enabled', _('Enable synchronization')));

  const address = new Adw.EntryRow({title: _('Server address')});
  group.add(address);

  const apiKey = new Adw.PasswordEntryRow({title: _('API key')});
  group.add(apiKey);

  const channel = new Adw.ComboRow({title: _('Active channel')});
  const refresh = new Gtk.Button({
    icon_name: 'view-refresh-symbolic',
    valign: Gtk.Align.CENTER,
    css_classes: ['flat'],
    tooltip_text: _('Refresh channels'),
  });
  channel.add_suffix(refresh);
  group.add(channel);

  const status = new Adw.ActionRow({title: _('Server status'), subtitle: _('Not tested')});
  const actions = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
  const apply = new Gtk.Button({label: _('Apply')});
  const test = new Gtk.Button({label: _('Test connection')});
  actions.append(apply);
  actions.append(test);
  status.add_suffix(actions);
  group.add(status);

  let channelIds = [];
  let busy = false;

  const setBusy = value => {
    busy = value;
    apply.sensitive = !value;
    test.sensitive = !value;
    refresh.sensitive = !value;
  };
  const showError = error => {
    status.subtitle = syncErrorMessage(error, _) || _('Synchronization request failed');
  };
  const renderChannels = (channels, activeChannelId) => {
    channelIds = channels.map(item => item.id);
    if (channelIds.length === 0) {
      channel.model = Gtk.StringList.new([_('No available channels')]);
      channel.selected = 0;
      channel.sensitive = false;
      return;
    }
    channel.model = Gtk.StringList.new(channels.map(item => item.name));
    const selected = channelIds.indexOf(activeChannelId);
    channel.selected = selected >= 0 ? selected : 0;
    channel.sensitive = true;
  };
  const fill = configuration => {
    address.text = configuration.serverAddress;
    apiKey.text = configuration.apiKey;
  };
  const persistInputs = async () => {
    const selectedChannelId = channel.sensitive
      ? (channelIds[channel.selected] ?? store.current.activeChannelId)
      : store.current.activeChannelId;
    const configuration = await store.save({
      ...store.current,
      serverAddress: address.text,
      apiKey: apiKey.text,
      activeChannelId: selectedChannelId,
    });
    notifyConfigurationChanged(settings);
    return configuration;
  };
  const loadChannels = async configuration => withTransport(configuration, deviceId, async transport => {
    const result = validateChannels(await transport.channels(), configuration.activeChannelId);
    let current = configuration;
    if (result.length > 0 && !result.some(item => item.id === configuration.activeChannelId)) {
      current = await store.save({...configuration, activeChannelId: result[0].id});
      notifyConfigurationChanged(settings);
    }
    const channels = result.map(item => ({...item, active: item.id === current.activeChannelId}));
    renderChannels(channels, current.activeChannelId);
    return {configuration: current, channels};
  });
  const run = async operation => {
    if (busy)
      return;
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  apply.connect('clicked', () => run(async () => {
    const configuration = await persistInputs();
    try {
      const result = await loadChannels(configuration);
      status.subtitle = result.configuration.apiKey
        ? _('Connection settings saved · API key configured')
        : _('Connection settings saved · API key not configured');
    } catch (error) {
      status.subtitle = [
        _('Connection settings saved locally'),
        syncErrorMessage(error, _) || _('Synchronization request failed'),
      ].join(' · ');
    }
  }));
  test.connect('clicked', () => run(async () => {
    const configuration = await persistInputs();
    status.subtitle = _('Connecting…');
    const started = GLib.get_monotonic_time();
    const server = await withTransport(configuration, deviceId, transport => transport.status());
    const result = validateStatus(server);
    const latency = Math.max(0, Math.round((GLib.get_monotonic_time() - started) / 1000));
    await loadChannels(configuration);
    const serverState = result.status === 'degraded'
      ? _('Degraded')
      : _('Online');
    status.subtitle = [serverState, result.implementationVersion, `${latency} ms`]
      .filter(Boolean).join(' · ');
  }));
  refresh.connect('clicked', () => run(async () => {
    status.subtitle = _('Loading channels…');
    const configuration = await persistInputs();
    const result = await loadChannels(configuration);
    status.subtitle = result.channels.length > 0
      ? _('Channels refreshed')
      : _('No available channels');
  }));

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    run(async () => {
      status.subtitle = _('Loading…');
      const configuration = await store.load();
      fill(configuration);
      renderChannels([], configuration.activeChannelId);
      if (!store.exists) {
        status.subtitle = _('Connection settings are not configured');
        return;
      }
      try {
        const result = await loadChannels(configuration);
        status.subtitle = result.configuration.apiKey
          ? _('Connection settings loaded · API key configured')
          : _('Connection settings loaded · API key not configured');
      } catch (error) {
        status.subtitle = [
          _('Connection settings loaded locally'),
          syncErrorMessage(error, _) || _('Synchronization request failed'),
        ].join(' · ');
      }
    });
    return GLib.SOURCE_REMOVE;
  });
  return group;
}

async function withTransport(configuration, deviceId, operation) {
  const transport = new HttpTransport(configuration, {deviceId});
  try {
    return await operation(transport);
  } finally {
    transport.abort();
  }
}

function notifyConfigurationChanged(settings) {
  settings.set_uint(
    'sync-configuration-revision',
    (settings.get_uint('sync-configuration-revision') + 1) >>> 0,
  );
}
