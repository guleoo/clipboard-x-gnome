import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function buildEditorArgv(template, uri, localPath = null) {
  return parseEditorCommand(template, uri, localPath).argv;
}

export async function launchEditor({command, uri, bytes = null}) {
  const file = Gio.File.new_for_uri(uri);
  const parsed = parseEditorCommand(command, uri, file.get_path());
  const input = parsed.standardInput ? await openStandardInput(file, bytes) : null;
  const flags = parsed.standardInput
    ? Gio.SubprocessFlags.STDIN_PIPE
    : Gio.SubprocessFlags.NONE;
  const launcher = new Gio.SubprocessLauncher({flags});
  try {
    const process = launcher.spawnv(parsed.argv);
    if (input)
      await writeStandardInput(process, input);
    return process;
  } finally {
    // Also release the input if spawning fails before splice takes ownership.
    if (input && !input.is_closed())
      input.close(null);
  }
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

async function openStandardInput(file, bytes) {
  if (bytes)
    return Gio.MemoryInputStream.new_from_bytes(bytes);
  if (!file.get_path())
    throw new Error('The editor command requires image data or a local file for standard input');
  return new Promise((resolve, reject) => file.read_async(
    GLib.PRIORITY_DEFAULT, null, (source, result) => {
      try { resolve(source.read_finish(result)); } catch (error) { reject(error); }
    },
  ));
}

function writeStandardInput(process, source) {
  return new Promise((resolve, reject) => {
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
