project(
  'clipboard-x',
  version: '0.1.0',
  license: 'GPL-3.0-or-later',
  meson_version: '>=1.6.0',
)

gnome = import('gnome')
fs = import('fs')

extension_uuid = 'clipboard-x@guleo.github.io'
schema_id = 'io.github.guleo.clipboard-x'
target = get_option('target')

if target == 'local'
  data_home = run_command(
    'sh', '-c', 'printf %s "${XDG_DATA_HOME:-$HOME/.local/share}"',
    check: true,
  ).stdout()
  extension_dir = data_home / 'gnome-shell' / 'extensions' / extension_uuid
  schema_dir = extension_dir / 'schemas'
elif target == 'system'
  extension_dir = get_option('datadir') / 'gnome-shell' / 'extensions' / extension_uuid
  schema_dir = get_option('datadir') / 'glib-2.0' / 'schemas'
else
  extension_dir = meson.project_build_root() / extension_uuid
  schema_dir = extension_dir / 'schemas'
endif

metadata = configuration_data()
metadata.set('uuid', extension_uuid)
metadata.set('version', meson.project_version())
metadata.set('schema', schema_id)

configure_file(
  input: 'data/metadata.json.in',
  output: 'metadata.json',
  configuration: metadata,
  install_dir: extension_dir,
)

install_subdir('src', strip_directory: true, install_dir: extension_dir)
install_data('data/stylesheet.css', install_dir: extension_dir)

schema_source = files('schemas/io.github.guleo.clipboard-x.gschema.xml')
install_data(schema_source, install_dir: schema_dir)

if target != 'system'
  compiled_schema = custom_target(
    'compile-schema',
    input: schema_source,
    output: 'gschemas.compiled',
    command: [
      find_program('glib-compile-schemas'),
      '--strict',
      '--targetdir=@OUTDIR@',
      meson.current_source_dir() / 'schemas',
    ],
    build_by_default: true,
    install: true,
    install_dir: schema_dir,
  )
else
  gnome.post_install(glib_compile_schemas: true)
endif

test_runner = find_program('gjs')
test('core', test_runner, args: ['-m', meson.current_source_dir() / 'tests/core.test.js'])
test('protocol', test_runner, args: ['-m', meson.current_source_dir() / 'tests/protocol.test.js'])
test('tools', test_runner, args: ['-m', meson.current_source_dir() / 'tests/tools.test.js'])
test(
  'sync-integration',
  find_program('dbus-run-session'),
  args: [
    '--',
    find_program('bash'),
    meson.current_source_dir() / 'tests/run-sync-integration.sh',
  ],
  timeout: 30,
)

if target == 'package'
  meson.add_install_script(
    find_program('7z'),
    'a',
    '-tzip',
    meson.project_build_root() / 'clipboard-x.zip',
    extension_dir / '*',
  )
endif
