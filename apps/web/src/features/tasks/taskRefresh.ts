export async function prepareRecurringTasksThenLoad<T>(
  prepare: () => Promise<unknown>,
  load: () => Promise<T>,
): Promise<T> {
  // The day feed must not wait on a best-effort recurring-task catch-up.
  // Persisted assignments are already authoritative and should render as soon
  // as their realtime event arrives.
  void prepare().catch(() => undefined);
  return load();
}
