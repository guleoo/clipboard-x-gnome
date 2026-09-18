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
assert(metadataTemplate.url === 'https://github.com/Guleo/clipboard-x-gnome',
  'extension metadata must link to the renamed repository');
assert(metadataTemplate.uuid === '@uuid@' && metadataTemplate['gettext-domain'] === 'clipboard-x',
  'renaming the project must not change the installed extension identity');
assert(/project\(\s*'clipboard-x-gnome'/u.test(meson),
  'Meson must use the public project name');
assert(meson.includes("meson.project_build_root() / 'clipboard-x-gnome.zip'"),
  'Meson must publish the renamed archive');
assert(Object.values(packageDocument.scripts).filter(value => value.includes('--extension '))
  .every(value => value.includes('build/clipboard-x-gnome.zip')),
  'Shell test scripts must consume the renamed archive');
assert(packageScript.includes('basename -- "$archive"'),
  'the packager must derive its temporary archive name from the requested artifact');
