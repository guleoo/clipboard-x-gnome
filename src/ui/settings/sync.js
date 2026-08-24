import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {variantDictionary} from '../../common/dbus.js';
import {
  channel as validateChannel,
  configuration as validateConfiguration,
  configurationChanges,
  connectionResult as validateConnectionResult,
} from '../../sync/configuration.js';
import {SYNC_INTERFACE} from '../../sync/constants.js';

export function create(settings, deviceId, rows) {
  const group = new Adw.PreferencesGroup({title: _('Service connection')});
  group.add(rows.switch('sync-enabled', _('Enable synchronization service')));

  const address = new Adw.EntryRow({title: _('Server address')});
  group.add(address);

  const apiKey = new Adw.PasswordEntryRow({title: _('API key'), show_peek_icon: true});
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

  const status = new Adw.ActionRow({title: _('Service status'), subtitle: _('Not tested')});
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
    status.subtitle = error?.message ?? String(error);
  };
  const showApiKeyState = configured => {
    apiKey.set_tooltip_text(configured
      ? _('An API key is configured; leave this field empty to keep it')
      : _('Enter the API key assigned to this device'));
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
  const load = async () => {
    if (busy)
      return;
    setBusy(true);
    status.subtitle = _('Loading…');
    try {
      const [configuration, channels] = await Promise.all([
        getConfiguration(settings, deviceId),
        listChannels(settings, deviceId),
      ]);
      address.text = configuration.serverAddress;
      apiKey.text = '';
      showApiKeyState(configuration.apiKeyConfigured);
      renderChannels(channels, configuration.activeChannelId);
      status.subtitle = configuration.apiKeyConfigured
        ? _('Connection settings loaded · API key configured')
        : _('Connection settings loaded · API key not configured');
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  const applyChanges = async () => {
    const changes = {serverAddress: address.text};
    const enteredApiKey = apiKey.text.trim();
    if (enteredApiKey)
      changes.apiKey = enteredApiKey;
    if (channel.sensitive && channelIds[channel.selected])
      changes.activeChannelId = channelIds[channel.selected];
    const configuration = await updateConfiguration(settings, deviceId, changes);
    apiKey.text = '';
    showApiKeyState(configuration.apiKeyConfigured);
    return configuration;
  };
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
    let configuration = await applyChanges();
    const channels = await listChannels(settings, deviceId);
    if (channels.length > 0
        && !channels.some(item => item.id === configuration.activeChannelId)) {
      configuration = await updateConfiguration(settings, deviceId, {
        activeChannelId: channels[0].id,
      });
    }
    status.subtitle = configuration.apiKeyConfigured
      ? _('Connection settings saved · API key configured')
      : _('Connection settings saved · API key not configured');
    renderChannels(channels, configuration.activeChannelId);
  }));
  test.connect('clicked', () => run(async () => {
    status.subtitle = _('Connecting…');
    const result = await testConnection(settings, deviceId);
    status.subtitle = [
      result.state,
      result.serverVersion,
      `${result.latencyMs} ms`,
      result.message,
    ].filter(Boolean).join(' · ');
  }));
  refresh.connect('clicked', () => run(async () => {
    status.subtitle = _('Loading channels…');
    const configuration = await getConfiguration(settings, deviceId);
    const channels = await listChannels(settings, deviceId);
    renderChannels(channels, configuration.activeChannelId);
    status.subtitle = channels.length > 0
      ? _('Channels refreshed')
      : _('No available channels');
  }));

  GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
    load();
    return GLib.SOURCE_REMOVE;
  });
  return group;
}

async function getConfiguration(settings, deviceId) {
  const reply = await call(settings, 'GetConfiguration', new GLib.Variant('(s)', [deviceId]), '(a{sv})');
  return validateConfiguration(unpack(reply.deepUnpack()[0]));
}

async function updateConfiguration(settings, deviceId, changes) {
  const serialized = configurationChanges(changes);
  const reply = await call(settings, 'UpdateConfiguration', new GLib.Variant('(sa{sv})', [
    deviceId,
    variantDictionary(serialized),
  ]), '(a{sv})');
  return validateConfiguration(unpack(reply.deepUnpack()[0]));
}

async function listChannels(settings, deviceId) {
  const reply = await call(settings, 'ListChannels', new GLib.Variant('(s)', [deviceId]), '(aa{sv})');
  const values = reply.deepUnpack()[0];
  if (!Array.isArray(values) || values.length > 10_000)
    throw new Error(_('The synchronization service returned an invalid channel list'));
  const ids = new Set();
  return values.map(value => {
    const result = validateChannel(unpack(value));
    if (ids.has(result.id))
      throw new Error(_('The synchronization service returned duplicate channels'));
    ids.add(result.id);
    return result;
  });
}

async function testConnection(settings, deviceId) {
  const reply = await call(settings, 'TestConnection', new GLib.Variant('(s)', [deviceId]), '(a{sv})', 15_000);
  return validateConnectionResult(unpack(reply.deepUnpack()[0]));
}

function call(settings, method, parameters, replyType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    Gio.DBus.session.call(
      settings.get_string('service-bus-name'),
      settings.get_string('service-object-path'),
      SYNC_INTERFACE,
      method,
      parameters,
      new GLib.VariantType(replyType),
      Gio.DBusCallFlags.NONE,
      timeout,
      null,
      (connection, result) => {
        try {
          resolve(connection.call_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

function unpack(value) {
  if (value instanceof GLib.Variant)
    return unpack(value.deepUnpack());
  if (Array.isArray(value))
    return value.map(unpack);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
  return value;
}
