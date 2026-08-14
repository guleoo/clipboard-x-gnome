import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

export function buildEditorArgv(template, uri, localPath = null) {
  const [ok, parsed] = GLib.shell_parse_argv(template.trim());
  if (!ok || parsed.length === 0)
    throw new Error('The image editor command is empty or invalid');

  let usedPlaceholder = false;
  const argv = parsed.map(argument => argument.replace(/%%|%u|%f/g, placeholder => {
    if (placeholder === '%%')
      return '%';

    usedPlaceholder = true;
    if (placeholder === '%u')
      return uri;
    if (!localPath)
      throw new Error('The editor command requires a local file path');
    return localPath;
  }));

  if (!usedPlaceholder)
    argv.push(uri);
  return argv;
}
export function launchEditor({appId, command, uri, launchContext = null}) {
  if (appId) {
    const app = GioUnix.DesktopAppInfo.new(appId);
    if (!app)
      throw new Error(`Image editor is not installed: ${appId}`);
    if (!app.launch_uris([uri], launchContext))
      throw new Error(`Unable to launch image editor: ${appId}`);
    return null;
  }

  const file = Gio.File.new_for_uri(uri);
  const argv = buildEditorArgv(command, uri, file.get_path());
  const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
  return launcher.spawnv(argv);
}
