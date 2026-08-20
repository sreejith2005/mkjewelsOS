import type { ParsedTaskCsv, TaskImportMapping } from "./parseCsv";

export type ImportFrequency = "once" | "daily" | "weekly" | "monthly";

export type ImportedTaskRow = Readonly<{
  title: string;
  doer_name?: string;
  doer_email?: string;
  description?: string;
  due_at?: string;
  priority?: string;
  category?: string;
  branch?: string;
  department?: string;
  checklist: readonly string[];
  frequency: ImportFrequency;
  source_rows: readonly number[];
}>;

export type ImportPreview = Readonly<{
  accepted: readonly ImportedTaskRow[];
  blocked: readonly Readonly<{ sourceRows: readonly number[]; reason: string }> [];
}>;

type Candidate = ImportedTaskRow & Readonly<{ group: string }>;

function value(row: Readonly<Record<string, string>>, header: string | undefined) {
  return header ? (row[header] ?? "").trim() : "";
}

function frequency(raw: string): ImportFrequency | null {
  if (!raw || raw.toLocaleLowerCase() === "once") return "once";
  if (["daily", "weekly", "monthly"].includes(raw.toLocaleLowerCase())) return raw.toLocaleLowerCase() as ImportFrequency;
  return null;
}

function comparable(candidate: Candidate) {
  const { checklist: _checklist, source_rows: _sourceRows, group: _group, ...fields } = candidate;
  return JSON.stringify(fields);
}

export function normalizeImportRows(parsed: ParsedTaskCsv, mapping: TaskImportMapping): ImportPreview {
  const accepted: ImportedTaskRow[] = [];
  const blocked: Array<{ sourceRows: readonly number[]; reason: string }> = [];
  const grouped = new Map<string, Candidate[]>();

  parsed.rows.forEach((row, index) => {
    const title = value(row, mapping.title);
    const doerName = value(row, mapping.doerName);
    const doerEmail = value(row, mapping.doerEmail);
    const parsedFrequency = frequency(value(row, mapping.frequency));
    if (!title) {
      blocked.push({ sourceRows: [index + 2], reason: "Task title is required" });
      return;
    }
    if (!doerName && !doerEmail) {
      blocked.push({ sourceRows: [index + 2], reason: "A doer name or email is required" });
      return;
    }
    if (!parsedFrequency) {
      blocked.push({ sourceRows: [index + 2], reason: "Frequency must be once, daily, weekly, or monthly" });
      return;
    }
    const checklistItem = value(row, mapping.checklist);
    const candidate: Candidate = {
      title,
      ...(doerName ? { doer_name: doerName } : {}),
      ...(doerEmail ? { doer_email: doerEmail } : {}),
      ...(value(row, mapping.description) ? { description: value(row, mapping.description) } : {}),
      ...(value(row, mapping.dueAt) ? { due_at: value(row, mapping.dueAt) } : {}),
      ...(value(row, mapping.priority) ? { priority: value(row, mapping.priority) } : {}),
      ...(value(row, mapping.category) ? { category: value(row, mapping.category) } : {}),
      ...(value(row, mapping.branch) ? { branch: value(row, mapping.branch) } : {}),
      ...(value(row, mapping.department) ? { department: value(row, mapping.department) } : {}),
      checklist: checklistItem ? [checklistItem] : [],
      frequency: parsedFrequency,
      source_rows: [index + 2],
      group: value(row, mapping.taskGroup),
    };
    if (!candidate.group) {
      const { group: _group, ...task } = candidate;
      accepted.push(task);
      return;
    }
    grouped.set(candidate.group, [...(grouped.get(candidate.group) ?? []), candidate]);
  });

  grouped.forEach((candidates) => {
    const first = candidates[0];
    if (!first) return;
    if (candidates.some((candidate) => comparable(candidate) !== comparable(first))) {
      blocked.push({ sourceRows: candidates.flatMap((candidate) => candidate.source_rows), reason: "Task group has conflicting task details" });
      return;
    }
    const { group: _group, ...task } = first;
    accepted.push({ ...task, checklist: candidates.flatMap((candidate) => candidate.checklist), source_rows: candidates.flatMap((candidate) => candidate.source_rows) });
  });

  return { accepted, blocked };
}
