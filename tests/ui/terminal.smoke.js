import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UUID = 'clipboard-x@guleo.github.io';
const STATUS_AREA_NAME = 'clipboard-x';
const TEST_DIRECTORY = Gio.File.new_for_uri(import.meta.url).get_parent().get_path();
const TARGET_TITLE = 'Clipboard X Typing Target';

export const METRICS = {};

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

async function waitUntil(predicate, timeoutMilliseconds = 3000) {
  const deadline = GLib.get_monotonic_time() + timeoutMilliseconds * 1000;
  while (!predicate() && GLib.get_monotonic_time() < deadline)
    await Scripting.sleep(50);
  return predicate();
}

function targetWindow() {
  return global.get_window_actors()
    .map(actor => actor.meta_window)
    .find(window => window?.get_title() === TARGET_TITLE);
}

export async function run() {
  await Scripting.sleep(500);
  if (Main.extensionManager._initializationPromise)
    await Main.extensionManager._initializationPromise;

  const extension = Main.extensionManager.lookup(UUID);
  assert(extension?.enabled, `Clipboard X was not enabled (${extension?.error ?? 'unknown error'})`);
  await waitUntil(() => Boolean(Main.panel.statusArea[STATUS_AREA_NAME]));
  const terminalInput = Main.panel.statusArea[STATUS_AREA_NAME]?._actions?.extensionObject?._terminalInput;
  assert(terminalInput, 'Clipboard X terminal input is unavailable');

  const [output, outputStream] = Gio.File.new_tmp('clipboard-x-typing-XXXXXX');
  outputStream.close(null);
  const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
  launcher.setenv('GDK_BACKEND', 'wayland', true);
  launcher.setenv('GTK_A11Y', 'none', true);
  launcher.setenv('NO_AT_BRIDGE', '1', true);
  const process = launcher.spawnv([
    '/usr/bin/gjs',
    '-m',
    GLib.build_filenamev([TEST_DIRECTORY, '..', 'fixtures', 'typing-target.js']),
    output.get_path(),
  ]);

  try {
    assert(await waitUntil(() => Boolean(targetWindow())), 'Typing target window did not open');
    Main.overview.hide();
    Main.activateWindow(targetWindow());
    assert(await waitUntil(() => global.display.focus_window === targetWindow()),
      'Typing target window did not receive keyboard focus');
    await Scripting.sleep(200);

    const source = `[Unit]

# 服务描述

Description=frp client

# 确保在网络就绪后启动

After=network.target

[Service]

# 运行类型，simple 表示直接运行前台进程

Type=simple

# 【重要】启动命令，请务必替换为你的实际路径

ExecStart=/opt/frp/frpc -c /opt/frp/frpc.toml

# 如果 frp 崩溃，自动重启

Restart=on-failure

# 重启等待秒数

RestartSec=5s

# 允许服务访问的目录，建议设置为配置文件所在目录

WorkingDirectory=/opt/frp

# 安全加固 (可选)，限制权限，提高安全性

NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ProtectHome=yes

[Install]

# 多用户模式下自启

WantedBy=multi-user.target
`;
    await terminalInput.type(source);
    await Scripting.sleep(200);
    const [, contents] = output.load_contents(null);
    const actual = new TextDecoder().decode(contents);
    assert(actual === source,
      `Mixed-language simulated input changed character order (${actual.length}/${source.length})`);
  } finally {
    targetWindow()?.delete(global.get_current_time());
    process.force_exit();
    output.delete(null);
  }
}
