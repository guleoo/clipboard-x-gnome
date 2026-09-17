import Gio from 'gi://Gio';

const directory = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('device');
const files = Object.freeze({
  computer: 'computer-symbolic.svg',
  laptop: 'laptop-symbolic.svg',
  tablet: 'tablet-symbolic.svg',
  server: 'server-symbolic.svg',
  android: 'android-fill-symbolic.svg',
  apple: 'apple-fill-symbolic.svg',
  windows: 'windows-fill-symbolic.svg',
  linux: 'linux-symbolic.svg',
  debian: 'debian-symbolic.svg',
  archlinux: 'archlinux-symbolic.svg',
});

export const DEVICE_ICONS = Object.freeze(Object.keys(files));

export function deviceIcon(name) {
  const file = Object.hasOwn(files, name) ? files[name] : files.computer;
  return new Gio.FileIcon({file: directory.get_child(file)});
}
