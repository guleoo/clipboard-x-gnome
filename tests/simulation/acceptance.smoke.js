import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Desktop, assert, init} from './helpers/desktop.js';
export {init};

export async function run() {
  const directory = Gio.File.new_for_uri(import.meta.url).get_parent();
  const module = GLib.getenv('CBX_SIMULATION_MODULE');
  const selected = (GLib.getenv('CBX_SIMULATION_CASES') ?? '').split(',');
  const [, contents] = directory.get_child('manifest.json').load_contents(null);
  const registry = JSON.parse(new TextDecoder().decode(contents));
  const group = registry.find(value => value.module === module);
  assert(group && selected.every(id => group.cases.some(item => item.id === id)),
    'Use tools/test-simulation.py with registered case IDs');
  const {cases} = await import(directory.get_child(module).get_uri());
  assert(selected.every(id => typeof cases[id] === 'function'), 'Registered case has no implementation');
  const desktop = await Desktop.create();
  try {
    for (const id of selected) await desktop.check(id, cases[id]);
    print(`[simulation] COMPLETE ${module}: ${selected.length} cases`);
  } finally {
    await desktop.destroy();
  }
}
