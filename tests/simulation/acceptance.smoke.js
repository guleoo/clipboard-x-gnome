import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Desktop, assert, init} from './helpers/desktop.js';
export {init};

export async function run() {
  const directory = Gio.File.new_for_uri(import.meta.url).get_parent();
  const selected = (GLib.getenv('CBX_SIMULATION_CASES') ?? '').split(',');
  const [, contents] = directory.get_child('manifest.json').load_contents(null);
  const registry = JSON.parse(new TextDecoder().decode(contents));
  const modules = new Map(registry.flatMap(group => group.cases.map(item => [item.id, group.module])));
  assert(selected.every(id => modules.has(id)), 'Use tools/test-simulation.py with registered case IDs');
  const implementations = new Map();
  for (const id of selected) {
    const module = modules.get(id);
    if (!implementations.has(module))
      implementations.set(module, (await import(directory.get_child(module).get_uri())).cases);
    assert(typeof implementations.get(module)[id] === 'function', `Registered case ${id} has no implementation`);
  }
  // All selected cases share one Shell; each case restores the state it changes,
  // so a failure is reported and the remaining cases still run.
  const desktop = await Desktop.create();
  let failure = null;
  try {
    for (const id of selected) {
      try {
        await desktop.check(id, implementations.get(modules.get(id))[id]);
      } catch (error) {
        failure ??= error;
      }
    }
    print(`[simulation] COMPLETE: ${selected.length} cases`);
  } finally {
    await desktop.destroy();
  }
  if (failure)
    throw failure;
}
