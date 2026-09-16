// Keep a string GSettings key and a choice row synchronized in both directions.
export function bindStringChoice(settings, row, key, values) {
  const updateRow = () => {
    const selected = values.indexOf(settings.get_string(key));
    if (selected >= 0 && row.selected !== selected)
      row.selected = selected;
  };

  const rowSignal = row.connect('notify::selected', () => {
    const value = values[row.selected];
    if (value !== undefined && settings.get_string(key) !== value)
      settings.set_string(key, value);
  });
  const settingsSignal = settings.connect(`changed::${key}`, updateRow);
  updateRow();

  return () => {
    row.disconnect(rowSignal);
    settings.disconnect(settingsSignal);
  };
}
