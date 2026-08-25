export async function prepareRecurringTasksThenLoad<T>(
  prepare: () => Promise<unknown>,
  load: () => Promise<T>,
): Promise<T> {
  try {
    await prepare();
  } catch {
    // Recurrence preparation is best-effort. Persisted task rows remain the
    // source of truth for the employee's day board.
  }
  return load();
}
