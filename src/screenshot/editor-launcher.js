import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function buildEditorArgv(template, uri, localPath = null) {
  return parseEditorCommand(template, uri, localPath).argv;
}

export async function launchEditor({command, uri}) {
  const file = Gio.File.new_for_uri(uri);
  const path = file.get_path();
  const parsed = parseEditorCommand(command, uri, path);
  const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
  if (parsed.standardInput) {
    if (!path)
      throw new Error('The editor command requires a local file for standard input');
    // Give the child the file directly. Splicing to a blocking stdin pipe can
    // stall the Shell main loop while an editor is waiting for the compositor.
    launcher.set_stdin_file_path(path);
  }
  return launcher.spawnv(parsed.argv);
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
