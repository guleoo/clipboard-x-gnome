import Gio from 'gi://Gio';

const PRESERVED_KEYS = new Set([
  'device-id',
  'saved-phrases',
  'sync-configuration-revision',
  'tokenizer-dictionary-revision',
]);

export function restore(settings) {
  settings.reset('sync-enabled');
  // Delay mode is permanent for a Settings instance. Batch the reset separately
  // so the preferences window keeps applying later edits immediately.
  const batch = new Gio.Settings({
    settings_schema: settings.settings_schema,
    backend: settings.backend,
    path: settings.path,
  });
  batch.delay();
  try {
    for (const key of settings.list_keys()) {
      if (!PRESERVED_KEYS.has(key) && key !== 'sync-enabled')
        batch.reset(key);
    }
    batch.apply();
  } catch (error) {
    batch.revert();
    throw error;
  }
}
