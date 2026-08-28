export type TaskImportOutcome = Readonly<{ created: number; replayed: number; rejected: number; assigningLeft: number }>;

const count = (value: number) => value.toLocaleString("en-IN");

export function taskImportOutcomeMessage(outcome: TaskImportOutcome): { tone: "success" | "danger"; text: string } {
  if (outcome.rejected > 0) {
    const prefix = outcome.created > 0 ? `${count(outcome.created)} new records imported. ` : "No records were imported. ";
    return { tone: "danger", text: `${prefix}${count(outcome.rejected)} rows were rejected by the database. You can retry this same file after correcting the problem.` };
  }
  if (outcome.created === 0) {
    return { tone: "success", text: `This file was already imported. ${count(outcome.replayed)} existing records were skipped and no duplicates were created.` };
  }
  const skipped = outcome.replayed > 0 ? ` ${count(outcome.replayed)} existing records were skipped.` : "";
  const queued = outcome.assigningLeft > 0 ? ` ${count(outcome.assigningLeft)} of them still need an assignee and are waiting in Assigning Left.` : "";
  return { tone: "success", text: `${count(outcome.created)} new records imported.${skipped}${queued}` };
}
