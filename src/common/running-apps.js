export const BUS_NAME = 'org.gnome.Shell.Extensions.ClipboardXGnome';
export const OBJECT_PATH = '/org/gnome/Shell/Extensions/ClipboardXGnome';
export const INTERFACE = 'org.gnome.Shell.Extensions.ClipboardXGnome';
export const INTROSPECTION_XML = `
<node>
  <interface name="${INTERFACE}">
    <method name="ListRunningApplications">
      <arg type="a(ss)" direction="out"/>
    </method>
  </interface>
</node>`;

export function uniqueApplications(applications) {
  const byClass = new Map();
  for (const {name, wmClass} of applications) {
    const key = String(wmClass ?? '').trim();
    if (!key || byClass.has(key.toLocaleLowerCase()))
      continue;
    byClass.set(key.toLocaleLowerCase(), {name: String(name ?? '').trim() || key, wmClass: key});
  }
  return [...byClass.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.wmClass.localeCompare(right.wmClass));
}
