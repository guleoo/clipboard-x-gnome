// Actual application copy paths. No browser automation, DOM selection or MIME injection.
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {assert, block, pause, requireIsolation, until} from '../helpers/desktop.js';
import {Target} from '../helpers/target.js';

const normalized = text => text.replace(/\s+/gu, ' ').trim();
const fixtureScript = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_parent()
  .get_child('fixtures').get_child('clipboard-application.py').get_path();
function write(path, contents) {
  Gio.File.new_for_path(path).replace_contents(new TextEncoder().encode(contents), null, false,
    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}
function uri(path) { return Gio.File.new_for_path(path).get_uri(); }

export class Application {
  static async open(desktop, kind, {allowLoopback = false} = {}) {
    requireIsolation();
    const executable = GLib.find_program_in_path(kind)
      ?? (kind === 'chromium' ? GLib.find_program_in_path('chromium-browser') : null);
    if (!executable) block(`External application ${kind} is not installed`);
    if (!GLib.find_program_in_path('python3')) block('External application cleanup requires python3');
    const app = new Application(desktop, kind);
    const profile = `${app.directory}/profile`;
    GLib.mkdir_with_parents(profile, 0o700);
    const document = `${app.directory}/${app.title}.${kind === 'soffice' ? 'rtf' : 'html'}`;
    app.expected = `${app.title} bold italic & tail.`;
    let command;
    if (kind === 'soffice') {
      write(document, `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Liberation Sans;}}\n`
        + `\\viewkind4\\uc1\\pard\\f0\\fs28 ${app.title} \\b bold\\b0  \\i italic\\i0  & tail.\\par\n}`);
      // The new profile has no links, macros, recovery files or inherited extensions.
      GLib.mkdir_with_parents(`${profile}/user`, 0o700);
      write(`${profile}/user/registrymodifications.xcu`, '<?xml version="1.0" encoding="UTF-8"?>'
        + '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
        + '<item oor:path="/org.openoffice.Inet/Settings">'
        + '<prop oor:name="ooInetProxyType" oor:op="fuse"><value>2</value></prop>'
        + '<prop oor:name="ooInetHTTPProxyName" oor:op="fuse"><value>127.0.0.1</value></prop>'
        + '<prop oor:name="ooInetHTTPProxyPort" oor:op="fuse"><value>9</value></prop>'
        + '<prop oor:name="ooInetHTTPSProxyName" oor:op="fuse"><value>127.0.0.1</value></prop>'
        + '<prop oor:name="ooInetHTTPSProxyPort" oor:op="fuse"><value>9</value></prop>'
        + '<prop oor:name="ooInetNoProxy" oor:op="fuse"><value></value></prop>'
        + '</item></oor:items>');
      command = [kind, `-env:UserInstallation=${uri(profile)}`, '--norestore', '--nodefault',
        '--nofirststartwizard', '--nologo', '--writer', '--view', document];
    } else {
      write(document, '<!doctype html><html><head><meta charset="utf-8">'
        + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
        + `<title>${app.title}</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;`
        + 'font:22px sans-serif;background:white;color:black}main{max-width:85%;padding:30px}</style></head>'
        + `<body><main><p>${app.title} <b>bold</b> <i>italic</i> &amp; tail.</p></main></body></html>`);
      if (kind === 'firefox') {
        const preferences = {
          'browser.shell.checkDefaultBrowser': false, 'browser.aboutwelcome.enabled': false,
          'intl.locale.requested': 'en-US',
          'browser.startup.homepage_override.mstone': 'ignore', 'browser.startup.page': 0,
          'browser.newtabpage.enabled': false, 'browser.newtabpage.activity-stream.feeds.telemetry': false,
          'datareporting.policy.dataSubmissionEnabled': false, 'toolkit.telemetry.enabled': false,
          'app.update.auto': false, 'extensions.update.enabled': false,
          'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': 9,
          'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': 9,
          'network.proxy.no_proxies_on': allowLoopback ? '127.0.0.1' : '',
          'network.trr.mode': 5, 'network.dns.disablePrefetch': true, 'network.prefetch-next': false,
          'network.http.speculative-parallel-limit': 0,
        };
        write(`${profile}/user.js`, Object.entries(preferences)
          .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
        command = [kind, '--no-remote', '--new-instance', '--profile', profile, '--new-window', uri(document)];
      } else {
        command = [executable, `--user-data-dir=${profile}`, '--ozone-platform=wayland', '--no-first-run',
          '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
          '--disable-default-apps', '--disable-extensions', '--disable-sync', '--password-store=basic',
          '--proxy-server=http://127.0.0.1:9', `--proxy-bypass-list=${allowLoopback ? '127.0.0.1' : '<-loopback>'}`,
          `--host-resolver-rules=MAP * ~NOTFOUND${allowLoopback ? ', EXCLUDE 127.0.0.1' : ''}`, '--new-window', uri(document)];
        if (GLib.get_user_name() === 'root') command.splice(1, 0, '--no-sandbox');
      }
    }
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDERR_MERGE});
    launcher.set_stdout_file_path(`${app.directory}/application.log`);
    for (const name of ['http_proxy', 'https_proxy', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'])
      launcher.setenv(name, 'http://127.0.0.1:9', true);
    launcher.setenv('NO_PROXY', '', true);
    launcher.setenv('no_proxy', '', true);
    launcher.setenv('MOZ_ENABLE_WAYLAND', '1', true);
    launcher.setenv('GDK_BACKEND', 'wayland', true);
    launcher.setenv('SAL_USE_VCLPLUGIN', 'gtk3', true);
    app.process = launcher.spawnv(['python3', fixtureScript, 'launch', ...command]);
    app.group = app.process.get_identifier();
    app.exited = new Promise(resolve => app.process.wait_async(null, (process, result) => {
      try { process.wait_finish(result); } finally { app.finished = true; resolve(); }
    }));
    try {
      try {
        await until(() => app.window || app.finished, `actual ${kind} private document window`, 30000);
      } catch (error) {
        if (kind === 'soffice') block(`LibreOffice could not open a GUI document; a graphical GTK3 build is required. ${app.log}`);
        throw error;
      }
      if (!app.window && kind === 'soffice') block(`LibreOffice has no GUI document window. ${app.log}`);
      assert(app.window, `${kind} exited without opening a private document; ${app.log}`);
      return app;
    } catch (error) { await app.close(); throw error; }
  }

  constructor(desktop, kind) {
    this.desktop = desktop;
    this.kind = kind;
    this.directory = GLib.dir_make_tmp('cbx-clipboard-application-XXXXXX');
    this.title = `CBX-Application-${GLib.uuid_string_random()}`;
    this.finished = false;
  }
  get window() {
    return global.get_window_actors().map(actor => actor.meta_window)
      .find(window => window.get_title().includes(this.title));
  }
  get log() {
    try {
      const [, bytes] = Gio.File.new_for_path(`${this.directory}/application.log`).load_contents(null);
      return new TextDecoder().decode(bytes).slice(-2500);
    } catch { return 'No application diagnostic output'; }
  }
  async copy(window = this.window) {
    assert(window, 'The owned source window must still exist');
    await this.desktop.close();
    Main.activateWindow(window);
    await until(() => global.display.focus_window === window, 'external application keyboard focus');
    const box = window.get_frame_rect();
    await this.desktop.pointClick(box.x + box.width / 2, box.y + box.height / 2);
    await this.desktop.key(Clutter.KEY_a, [Clutter.KEY_Control_L]);
    await this.desktop.key(Clutter.KEY_c, [Clutter.KEY_Control_L]);
  }
  async signal(name) {
    const child = Gio.Subprocess.new(['python3', fixtureScript, 'stop', this.group, name], Gio.SubprocessFlags.NONE);
    await new Promise((resolve, reject) => child.wait_check_async(null, (process, result) => {
      try { process.wait_check_finish(result); resolve(); } catch (error) { reject(error); }
    }));
  }
  async close() {
    if (!this.process) return;
    // Only the document window and the process group created above belong to this case.
    this.window?.delete(global.get_current_time());
    await this.signal('TERM');
    for (let attempt = 0; !this.finished && attempt < 50; attempt++) await pause(20);
    await this.signal('KILL');
    await this.exited;
    this.process = null;
  }
}

async function richText(desktop, application, target) {
  const revision = desktop.app._controller.selectionRevision;
  await application.copy();
  await until(() => desktop.app._controller.selectionRevision > revision
    && !desktop.app._controller._captureInProgress && !desktop.app._controller._captureQueued
    && desktop.app._controller.items.some(item => item.text.includes(application.title)),
  `real ${application.kind} copy captured with all representations`, 15000);
  const matches = desktop.app._controller.items.filter(item => item.text.includes(application.title));
  assert(matches.length === 1, 'One native rich-text copy must not become separate plain/HTML entries');
  const item = matches[0];
  const plain = item.representations.find(value => value.mimeType.startsWith('text/plain'));
  const html = item.representations.find(value => value.mimeType === 'text/html');
  assert(plain && html && item.primary === plain, 'Actual rich-text offers must retain plain+HTML and prefer plain text');
  assert(normalized(item.text) === application.expected && normalized(item.preview.text) === application.expected,
    'History text and preview must show the real selected document text');
  const keys = item.representations.map(value => `${value.mimeType}:${value.sha256}`);
  assert(new Set(keys).size === keys.length, 'Native MIME aliases must not create duplicate representations');
  const actualPlain = await target.clipboard();
  const actualHtml = await target.clipboard('text/html');
  assert(normalized(actualPlain.text) === application.expected && plain.sha256 === actualPlain.sha256,
    'Independent GTK read must agree with the actual application plain bytes');
  assert(actualHtml.text.includes(application.title) && html.sha256 === actualHtml.sha256,
    'Independent GTK read must agree with the actual application HTML bytes');
}

async function image(desktop, application, target) {
  const source = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, false, 8, 512, 64);
  source.fill(0x23a4cdff);
  source.new_subpixbuf(256, 0, 256, 64).fill(0xe96b35ff);
  const path = `${application.directory}/${application.title}.png`;
  source.savev(path, 'png', [], []);
  const window = application.window;
  Main.activateWindow(window);
  await until(() => global.display.focus_window === window, 'browser navigation focus');
  await desktop.key(Clutter.KEY_l, [Clutter.KEY_Control_L]);
  await desktop.type(uri(path));
  await desktop.key(Clutter.KEY_Return);
  await until(() => window.get_title().includes('.png'), 'browser displays the standalone original PNG', 15000);
  await desktop.key(Clutter.KEY_F11);
  await until(() => window.is_fullscreen() && window.get_frame_rect().height === global.stage.height,
    'fullscreen image viewport has no browser toolbar offset');
  await pause(150);
  const revision = desktop.app._controller.selectionRevision;
  if (application.kind === 'firefox') {
    // Firefox selects the image URL with Ctrl+A/C; its native Copy Image menu
    // action is the operation that actually offers image bytes. The private
    // profile requests en-US so the access key is independent of Shell locale.
    const box = window.get_frame_rect();
    await desktop.move(box.x + box.width / 2, box.y + box.height / 2);
    desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.PRESSED);
    await pause(25);
    desktop.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_SECONDARY, Clutter.ButtonState.RELEASED);
    await pause(150);
    await desktop.key(Clutter.KEY_y);
  } else {
    await application.copy(window);
  }
  await until(() => desktop.app._controller.selectionRevision > revision
    && !desktop.app._controller._captureInProgress && !desktop.app._controller._captureQueued
    && desktop.app._controller.items.some(item => item.isImage), 'native browser image copy captured', 15000);
  const item = desktop.app._controller.items.find(value => value.isImage);
  await desktop.app._controller.persist();
  const original = GdkPixbuf.Pixbuf.new_from_file(item.primary.path);
  assert(original.width === 512 && original.height === 64, 'Browser image capture must preserve the original, not a thumbnail');
  const pixels = original.get_pixels();
  for (const [x, color] of [[64, [35, 164, 205]], [448, [233, 107, 53]]]) {
    const offset = original.rowstride * 32 + original.n_channels * x;
    assert(color.every((value, component) => pixels[offset + component] === value),
      'Captured browser original must preserve both synthetic source colors');
  }
  const actual = await target.clipboard(item.primary.mimeType);
  assert(actual.sha256 === item.primary.sha256 && actual.size === item.primary.size,
    'Independent GTK image read must equal the browser-offered original bytes');
}

async function run(desktop, kind) {
  const target = await Target.open(desktop);
  let application;
  try {
    await target.offer(`external application baseline ${kind}`);
    application = await Application.open(desktop, kind);
    await richText(desktop, application, target);
    if (kind !== 'soffice') await image(desktop, application, target);
  } finally {
    try { await application?.close(); } finally { await target.close(); }
  }
}

export const cases = {
  'CLIP-02-firefox': desktop => run(desktop, 'firefox'),
  'CLIP-02-chromium': desktop => run(desktop, 'chromium'),
  'CLIP-02-office': desktop => run(desktop, 'soffice'),
};
