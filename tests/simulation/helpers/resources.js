// Always attempt every owned cleanup. Preserve the original assertion if cleanup
// also fails, instead of replacing useful evidence with a shutdown error.
export async function withCleanup(run, resources) {
  let result;
  let failure;
  try { result = await run(); } catch (error) { failure = error; }
  const errors = [];
  for (const resource of resources().filter(Boolean)) {
    try { await resource.close(); } catch (error) { errors.push(error); }
  }
  if (failure) {
    for (const error of errors) printerr(`[simulation] Cleanup failed: ${error.message}`);
    throw failure;
  }
  if (errors.length) throw new AggregateError(errors, 'Owned fixture cleanup failed');
  return result;
}
