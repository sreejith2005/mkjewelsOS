export type TaskParticipants = Readonly<{
  doerIds: readonly string[];
  watcherIds: readonly string[];
}>;

export function normalizeTaskParticipants(doerIds: readonly string[], watcherIds: readonly string[]): TaskParticipants {
  const uniqueDoers = [...new Set(doerIds)];
  const doerSet = new Set(uniqueDoers);
  return {
    doerIds: uniqueDoers,
    watcherIds: [...new Set(watcherIds)].filter((id) => !doerSet.has(id)),
  };
}
