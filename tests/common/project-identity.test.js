import Gio from 'gi://Gio';

const root = Gio.File.new_for_uri(import.meta.url)
  .get_parent()
  .get_parent()
  .get_parent();

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

function read(relativePath) {
  const [ok, contents] = root.resolve_relative_path(relativePath).load_contents(null);
  assert(ok, `${relativePath} could not be read`);
  return new TextDecoder().decode(contents);
}

const packageDocument = JSON.parse(read('package.json'));
const metadataTemplate = JSON.parse(read('data/metadata.json.in'));
const meson = read('meson.build');
const packageScript = read('tools/package.sh');

assert(packageDocument.name === 'clipboard-x-gnome',
  'the Node package must use the public project name');
assert(packageDocument.author?.name === 'guleoo'
    && packageDocument.author.url === 'https://github.com/guleoo',
  'package metadata must identify the author');
assert(packageDocument.license === 'GPL-3.0-or-later',
  'package license must match Meson');
assert(packageDocument.homepage === 'https://github.com/guleoo/clipboard-x-gnome'
    && packageDocument.repository?.url === 'https://github.com/guleoo/clipboard-x-gnome.git'
    && packageDocument.bugs?.url === 'https://github.com/guleoo/clipboard-x-gnome/issues',
  'package links must use the actual GitHub account');
assert(metadataTemplate.url === packageDocument.homepage,
  'extension metadata must link to the public repository');
assert(metadataTemplate.uuid === '@uuid@' && metadataTemplate['gettext-domain'] === 'clipboard-x',
  'extension metadata must use the configured UUID and gettext domain');
assert(/project\(\s*'clipboard-x-gnome'/u.test(meson),
  'Meson must use the public project name');
assert(meson.includes("extension_uuid = 'clipboard-x@guleoo.github.io'")
    && read('src/entry/constants.js').includes("UUID = 'clipboard-x@guleoo.github.io'"),
  'build and runtime extension identities must match the author namespace');
assert(meson.includes("release_archive = 'clipboard-x-gnome_@0@.zip'.format(meson.project_version())")
    && meson.includes('meson.project_build_root() / release_archive'),
  'Meson must include the project version in the release archive name');
assert(Object.values(packageDocument.scripts).filter(value => value.includes('--extension '))
  .every(value => value.includes('build/clipboard-x-gnome_')
    && value.includes("require('./package.json').version")),
  'Shell test scripts must consume the archive matching the project version');
assert(packageScript.includes('basename -- "$archive"'),
  'the packager must derive its temporary archive name from the requested artifact');
