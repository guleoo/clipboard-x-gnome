import Gio from 'gi://Gio';

const root = Gio.File.new_for_uri(import.meta.url)
  .get_parent()
  .get_parent()
  .get_parent();

function features(path, heading, nextHeading) {
  const [ok, contents] = root.resolve_relative_path(path).load_contents(null);
  if (!ok)
    throw new Error(`Cannot read ${path}`);

  const document = new TextDecoder().decode(contents);
  const start = document.indexOf(`${heading}\n`);
  const end = document.indexOf(`${nextHeading}\n`, start);
  if (start < 0 || end < 0)
    throw new Error(`${path} must have a feature list before installation`);

  const section = document.slice(start + heading.length, end);
  if (section.includes('| --- |'))
    throw new Error(`${path} still uses a feature table`);

  const items = section.split('\n').filter(line => line.startsWith('- '));
  if (items.length < 10 || items.some(line => !/^- \*\*[^*]+\*\* — \S/u.test(line)))
    throw new Error(`${path} needs short named feature descriptions`);
  return items;
}

function simulatedInputGuide(path, useHeading, guideTitle, syncHeading, requiredText) {
  const [ok, contents] = root.resolve_relative_path(path).load_contents(null);
  if (!ok)
    throw new Error(`Cannot read ${path}`);

  const document = new TextDecoder().decode(contents);
  const useStart = document.indexOf(`${useHeading}\n`);
  const headings = document.split('\n')
    .filter(line => /^### \d+\. /u.test(line) && line.endsWith(guideTitle));
  const guideStart = headings.length === 1 ? document.indexOf(`${headings[0]}\n`) : -1;
  const syncStart = document.indexOf(`${syncHeading}\n`);
  if (useStart < 0 || guideStart <= useStart || syncStart <= guideStart)
    throw new Error(`${path} must explain simulated typing within the usage chapter`);

  const guide = document.slice(guideStart, syncStart).replace(/\s+/gu, ' ');
  for (const text of requiredText) {
    if (!guide.includes(text))
      throw new Error(`${path} does not explain ${text}`);
  }
}

const english = features('README.md', '## Features', '## Installation');
const chinese = features('README.zh-CN.md', '## 功能', '## 安装');

for (const [path, heading, fallback] of [
  ['README.md', '## Installation', '### Install from source'],
  ['README.zh-CN.md', '## 安装', '### 从源码安装'],
]) {
  const [ok, contents] = root.resolve_relative_path(path).load_contents(null);
  if (!ok)
    throw new Error(`Cannot read ${path}`);
  const document = new TextDecoder().decode(contents);
  const installStart = document.indexOf(`${heading}\n`);
  const fallbackStart = document.indexOf(`${fallback}\n`, installStart);
  if (installStart < 0 || fallbackStart <= installStart
      || !document.slice(installStart, fallbackStart).includes('https://extensions.gnome.org/'))
    throw new Error(`${path} must recommend the GNOME extension store before source installation`);
}

for (const [name, items, expected] of [
  ['README.md', english, ['Clipboard history', 'Token selection', 'Screenshots and editing', 'Color picker', 'Device synchronization']],
  ['README.zh-CN.md', chinese, ['剪切板历史', '分词选择', '截图编辑', '取色器', '设备同步']],
]) {
  for (const feature of expected) {
    if (!items.some(item => item.startsWith(`- **${feature}** — `)))
      throw new Error(`${name} is missing ${feature}`);
  }
}

simulatedInputGuide('README.md', '## Use Clipboard X', 'Simulated keyboard input',
  '## Synchronize devices', ['Ctrl+Enter', 'token panel', 'modifier-key presses', 'ordinary physical key presses', 'does not undo']);
simulatedInputGuide('README.zh-CN.md', '## 使用 Clipboard X', '模拟键盘输入',
  '## 同步设备', ['Ctrl+Enter', '分词面板', '修饰键', '普通物理按键', '不会撤销']);

for (const [path, heading, items, separation] of [
  ['README.md', '## Synchronize devices', english, 'Deploy your own'],
  ['README.zh-CN.md', '## 同步设备', chinese, '自行搭建'],
]) {
  const [ok, contents] = root.resolve_relative_path(path).load_contents(null);
  if (!ok)
    throw new Error(`Cannot read ${path}`);

  const document = new TextDecoder().decode(contents);
  const chapter = document.split(`${heading}\n`)[1]?.split('\n## ')[0];
  if (!chapter?.includes('`clipboard-x-server`') || !chapter.includes(separation)
      || !items.some(item => item.includes('`clipboard-x-server`')))
    throw new Error(`${path} must name the separate clipboard-x-server in its synchronization guidance`);
}

for (const [path, commandDescription] of [
  ['README.md', 'editor command'],
  ['README.zh-CN.md', '编辑器命令'],
]) {
  const [ok, contents] = root.resolve_relative_path(path).load_contents(null);
  if (!ok)
    throw new Error(`Cannot read ${path}`);
  const guide = new TextDecoder().decode(contents);
  if (!guide.includes(commandDescription) || !guide.includes('`gradia %i`'))
    throw new Error(`${path} must explain the configurable image editor command and Gradia example`);
}
