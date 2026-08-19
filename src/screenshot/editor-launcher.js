import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';

export function buildEditorArgv(template, uri, localPath = null) {
  return parseEditorCommand(template, uri, localPath).argv;
}

export async function launchEditor({appId, command, uri, bytes = null, launchContext = null}) {
  if (appId) {
    const app = GioUnix.DesktopAppInfo.new(appId);
    if (!app)
      throw new Error(`Image editor is not installed: ${appId}`);
    if (!app.launch_uris([uri], launchContext))
      throw new Error(`Unable to launch image editor: ${appId}`);
    return null;
  }

  const file = Gio.File.new_for_uri(uri);
  const parsed = parseEditorCommand(command, uri, file.get_path());
  if (parsed.standardInput && !bytes)
    throw new Error('The editor command requires image data for standard input');
  const flags = parsed.standardInput
    ? Gio.SubprocessFlags.STDIN_PIPE
    : Gio.SubprocessFlags.NONE;
  const launcher = new Gio.SubprocessLauncher({flags});
  const process = launcher.spawnv(parsed.argv);
  if (parsed.standardInput)
    await writeStandardInput(process, bytes);
  return process;
}

function parseEditorCommand(template, uri, localPath) {
  if (!template?.trim())
    throw new Error('The image editor command is empty');
  validatePlaceholders(template);

  const [ok, parsed] = GLib.shell_parse_argv(template.trim());
  if (!ok || parsed.length === 0)
    throw new Error('The image editor command is empty or invalid');

  let usedPlaceholder = false;
  let standardInput = false;
  const argv = [];
  for (const argument of parsed) {
    if (hasPlaceholder(argument, 'i')) {
      if (argument !== '%i')
        throw new Error('The standard-input placeholder must be a separate argument');
      usedPlaceholder = true;
      standardInput = true;
      continue;
    }
    argv.push(argument.replace(/%%|%u|%f/g, placeholder => {
      if (placeholder === '%%')
        return '%';

      usedPlaceholder = true;
      if (placeholder === '%u')
        return uri;
      if (!localPath)
        throw new Error('The editor command requires a local file path');
      return localPath;
    }));
  }

  if (!usedPlaceholder)
    argv.push(uri);
  return {argv, standardInput};
}

function validatePlaceholders(template) {
  for (let index = 0; index < template.length; index++) {
    if (template[index] !== '%')
      continue;
    const placeholder = template[index + 1];
    if (!placeholder || !['%', 'u', 'f', 'i'].includes(placeholder))
      throw new Error(`Unsupported image editor placeholder: %${placeholder ?? ''}`);
    index++;
  }
}

function hasPlaceholder(argument, expected) {
  for (let index = 0; index < argument.length; index++) {
    if (argument[index] !== '%')
      continue;
    if (argument[index + 1] === '%') {
      index++;
      continue;
    }
    if (argument[index + 1] === expected)
      return true;
    index++;
  }
  return false;
}

function writeStandardInput(process, bytes) {
  return new Promise((resolve, reject) => {
    const source = Gio.MemoryInputStream.new_from_bytes(bytes);
    const target = process.get_stdin_pipe();
    target.splice_async(
      source,
      Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
      GLib.PRIORITY_DEFAULT,
      null,
      (stream, result) => {
        try {
          stream.splice_finish(result);
          resolve();
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}
