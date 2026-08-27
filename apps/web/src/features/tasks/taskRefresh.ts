export async function prepareRecurringTasksThenLoad<T>(
  prepare: () => Promise<{ created?: number } | void>,
  load: () => Promise<T>,
  onRecurringTasksCreated?: (tasks: T) => void | Promise<void>,
): Promise<T> {
  // Render the persisted feed immediately, then reload only when the
  // background catch-up actually creates a due occurrence. This does not
  // rely on a realtime event reaching the open Tasks screen.
  const preparation = prepare();
  const initialTasks = await load();
  void preparation.then(async (outcome) => {
    if (outcome?.created && onRecurringTasksCreated) await onRecurringTasksCreated(await load());
  }).catch(() => undefined);
  return initialTasks;
}
