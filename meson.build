project(
  'clipboard-x-gnome',
  version: '1.0.1',
  license: 'GPL-3.0-or-later',
  meson_version: '>=1.6.0',
)

gnome = import('gnome')
fs = import('fs')
i18n = import('i18n')

extension_uuid = 'clipboard-x@guleoo.github.io'
schema_id = 'org.gnome.shell.extensions.clipboard-x'
target = get_option('target')
release_archive = 'clipboard-x-gnome_@0@.zip'.format(meson.project_version())

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

install_subdir(
  'src',
  strip_directory: true,
  install_dir: extension_dir,
  exclude_directories: ['clipboard/tokenizer/dictionary/seeds'],
)
install_data('data/stylesheet.css', install_dir: extension_dir)

subdir('po')

schema_source = files('schemas/org.gnome.shell.extensions.clipboard-x.gschema.xml')
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
test('translations', find_program('bash'), args: [meson.current_source_dir() / 'tests/i18n/coverage.sh'])
test('release-package', find_program('python3'), args: [meson.current_source_dir() / 'tests/common/release_package.test.py'])
test('release-script', find_program('python3'), args: [meson.current_source_dir() / 'tests/common/release_script.test.py'])
test('shell-compatibility-script', find_program('python3'),
  args: [meson.current_source_dir() / 'tests/common/shell_compatibility_script.test.py'])
test('common-foundation', test_runner, args: ['-m', meson.current_source_dir() / 'tests/common/foundation.test.js'])
test('logger', test_runner, args: ['-m', meson.current_source_dir() / 'tests/common/logger.test.js'])
test('dev-shell-script', find_program('python3'), args: [meson.current_source_dir() / 'tests/common/dev_shell_script.test.py'])
test('running-apps', test_runner, args: ['-m', meson.current_source_dir() / 'tests/common/running-apps.test.js'])
test('sync-device', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/device.test.js'])
test('device-icons', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/device-icons.test.js'])
test('sync-errors', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/errors.test.js'])
test('sync-configuration', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/configuration.test.js'])
test('sync-configuration-store', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/configuration-store.test.js'])
test('sync-connection-settings', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/sync-connection.test.js'])
test('sync-connection-http', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/sync-connection-http.test.js'])
test('clipboard-item', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/item.test.js'])
test('clipboard-text', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/text.test.js'])
test('clipboard-phrase-store', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/phrases/store.test.js'])
test('clipboard-history-order', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/history/order.test.js'])
test('clipboard-storage', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/history/storage.test.js'])
test('color-picker', test_runner, args: ['-m', meson.current_source_dir() / 'tests/color-picker/color.test.js'])
test('screenshot', test_runner,
  args: ['-m', meson.current_source_dir() / 'tests/screenshot/tools.test.js'],
  env: {'CBX_TEST_BUILD_DIR': meson.project_build_root()})
test('sync-policy', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/policy.test.js'])
test('sync-protocol', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/protocol.test.js'])
test('sync-http-client', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/http-client.test.js'])
test('sync-file-verifier', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/file-verifier.test.js'])
test('file-verification-settings', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/file-verification.test.js'])
test('sync-http-failures', test_runner,
  args: ['-m', meson.current_source_dir() / 'tests/sync/http-failures.test.js'],
  env: {'CBX_TEST_PYTHON': find_program('python3').full_path()},
  timeout: 30)
test('sync-transfers', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/transfers.test.js'])
test('sync-measurement', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/measurement.test.js'])
test('sync-diagnostics', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/diagnostics.test.js'])
test('sync-client', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/client.test.js'])
test('sync-lifecycle', test_runner, args: ['-m', meson.current_source_dir() / 'tests/sync/lifecycle.test.js'])
test('sync-receive', test_runner,
  args: ['-m', meson.current_source_dir() / 'tests/sync/receive.test.js'],
  env: {'GIO_USE_VFS': 'local'})
test('sync-receive-stress', test_runner,
  args: ['-m', meson.current_source_dir() / 'tests/sync/receive.test.js', '--stress'],
  env: {'GIO_USE_VFS': 'local'},
  suite: 'stress')
test(
  'sync-stress',
  test_runner,
  args: ['-m', meson.current_source_dir() / 'tests/sync/stress.test.js'],
  timeout: 60,
  suite: 'stress',
)
test(
  'sync-stream-stress',
  test_runner,
  args: ['-m', meson.current_source_dir() / 'tests/sync/stream-stress.test.js'],
  timeout: 60,
  suite: 'stress',
  env: {'CBX_TEST_PYTHON': find_program('python3').full_path()},
  is_parallel: false,
)
test('tokenizer-processors', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/tokenizer/processors.test.js'])
test('tokenizer-dictionary', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/tokenizer/dictionary.test.js'])
test('tokenizer-multilingual', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/tokenizer/multilingual.test.js'])
test('terminal-sequence', test_runner, args: ['-m', meson.current_source_dir() / 'tests/clipboard/terminal/sequence.test.js'])
test('panel-manager', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/panel-manager.test.js'])
test('focus-grid', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/focus-grid.test.js'])
test('panel-actions', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/panel-actions.test.js'])
test('entry-actions', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/entry-actions.test.js'])
test('sync-entry-state', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/sync-state.test.js'])
test('settings-defaults', test_runner,
  args: ['-m', meson.current_source_dir() / 'tests/ui/settings-defaults.test.js'],
  env: {'GSETTINGS_BACKEND': 'memory', 'CBX_TEST_BUILD_DIR': meson.project_build_root()})
test('shortcut-capture', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/shortcut-capture.test.js'])
test('string-choice', test_runner, args: ['-m', meson.current_source_dir() / 'tests/ui/string-choice.test.js'])
test(
  'stress',
  test_runner,
  args: ['-m', meson.current_source_dir() / 'tests/clipboard/history/stress.test.js'],
  timeout: 30,
  suite: 'stress',
)
if target == 'package'
  meson.add_install_script(
    find_program('bash'),
    meson.project_source_root() / 'tools' / 'package.sh',
    meson.project_build_root() / release_archive,
    extension_dir,
    'org.gnome.shell.extensions.clipboard-x.gschema.xml',
    meson.project_source_root() / 'src',
  )
endif
