const PRESERVED_KEYS = new Set([
  'device-id',
  'saved-phrases',
  'sync-configuration-revision',
  'tokenizer-dictionary-revision',
]);

export function restore(settings) {
  settings.reset('sync-enabled');
  settings.delay();
  try {
    for (const key of settings.list_keys()) {
      if (!PRESERVED_KEYS.has(key) && key !== 'sync-enabled')
        settings.reset(key);
    }
    settings.apply();
  } catch (error) {
    settings.revert();
    throw error;
  }
}
