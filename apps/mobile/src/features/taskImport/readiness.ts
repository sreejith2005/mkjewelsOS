type MappedTaskImportRow = Readonly<{ assignee_profile_id: string }>;

export function taskImportActionLabel(total: number, ready: number): string {
  const noun = ready === 1 ? "record" : "records";
  return ready === total ? `Import all ${ready} ${noun}` : `Import ${ready} valid ${noun}`;
}

export function taskImportBlockedReminder(blocked: number): string {
  if (blocked === 0) return "";
  return ` ${blocked.toLocaleString("en-IN")} source row${blocked === 1 ? " remains" : "s remain"} blocked for correction.`;
}

export function taskImportReadinessCounts(rows: readonly MappedTaskImportRow[], blocked: number) {
  const assigned = rows.filter((row) => Boolean(row.assignee_profile_id)).length;
  return {
    ready: rows.length,
    blocked,
    assigned,
    assigningLeft: rows.length - assigned,
  };
}
