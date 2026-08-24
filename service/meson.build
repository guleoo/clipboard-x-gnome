python3 = find_program('python3')

if target == 'local'
  service_install_dir = data_home / 'clipboard-x' / 'service'
  service_executable = service_install_dir / 'clipboard-x-service'
  dbus_service_dir = data_home / 'dbus-1' / 'services'
elif target == 'system'
  service_install_dir = get_option('libexecdir') / 'clipboard-x'
  service_executable = get_option('prefix') / service_install_dir / 'clipboard-x-service'
  dbus_service_dir = get_option('datadir') / 'dbus-1' / 'services'
endif

if target != 'package'
  service_python_dir = service_install_dir / 'python'
  install_subdir(
    'src/clipboard_x_service',
    install_dir: service_python_dir,
    exclude_directories: ['__pycache__'],
  )

  launcher = configuration_data()
  launcher.set('python_path', python3.full_path())
  launcher.set_quoted('service_python_path', service_python_dir)
  configure_file(
    input: 'data/clipboard-x-service.in',
    output: 'clipboard-x-service',
    configuration: launcher,
    install: true,
    install_dir: service_install_dir,
    install_mode: 'rwxr-xr-x',
  )

  activation = configuration_data()
  activation.set('service_executable', service_executable)
  configure_file(
    input: 'data/io.github.guleo.ClipboardX.SyncService.service.in',
    output: 'io.github.guleo.ClipboardX.SyncService.service',
    configuration: activation,
    install: true,
    install_dir: dbus_service_dir,
  )
endif

test(
  'service-unit',
  python3,
  args: [
    '-m', 'unittest', 'discover',
    '-s', meson.current_source_dir() / 'tests',
    '-v',
  ],
  env: {
    'PYTHONPATH': meson.current_source_dir() / 'src',
  },
)

test(
  'service-dbus',
  find_program('dbus-run-session'),
  args: [
    '--',
    find_program('bash'),
    meson.current_source_dir() / 'tests' / 'run-dbus-smoke.sh',
  ],
  timeout: 15,
)
