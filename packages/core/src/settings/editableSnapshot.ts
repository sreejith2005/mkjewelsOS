export type EditableSnapshot<T> = Readonly<{ value: T; baseline: T }>;

function settingsSnapshotVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  if ("version" in value && typeof value.version === "number") return value.version;
  if ("settings_version" in value && typeof value.settings_version === "number") return value.settings_version;
  return null;
}

/** Settings snapshots are JSON values. Keep optimistic versions with dirty edits. */
export function receiveEditableSnapshot<T>(current: EditableSnapshot<T>, incoming: T): EditableSnapshot<T> {
  const previousVersion = settingsSnapshotVersion(current.baseline);
  const incomingVersion = settingsSnapshotVersion(incoming);
  if (previousVersion !== null && incomingVersion !== null && incomingVersion < previousVersion) return current;
  return JSON.stringify(current.value) === JSON.stringify(current.baseline)
    ? { value: incoming, baseline: incoming }
    : current;
}

/** Advance only server-confirmed metadata while preserving edits made during save. */
export function acknowledgeEditableSnapshot<T>(current: EditableSnapshot<T>, submitted: T, confirmed: T, rebase: (value: T) => T = (value) => value): EditableSnapshot<T> {
  return { value: JSON.stringify(current.value) === JSON.stringify(submitted) ? confirmed : rebase(current.value), baseline: confirmed };
}
