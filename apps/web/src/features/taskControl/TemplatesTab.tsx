import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui";
import {
  templateCanActivate, templateFrequencyLabel, templateSourceLabel, templateStatusLabel, templateWorkTypeLabel,
  type TaskTemplateDirectoryRow,
} from "@/features/taskTemplates/api";

export function prettyDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00+05:30`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function prettyTime(value: string | null): string {
  if (!value) return "—";
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display).padStart(2, "0")}:${minutes ?? "00"} ${suffix}`;
}

function Chip({ children, tone }: { children: string; tone: "gold" | "muted" }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        tone === "gold" ? "bg-gold/15 text-gold" : "bg-task-border/60 text-task-text-muted"
      }`}
    >
      {children}
    </span>
  );
}

function EvidenceFlag({ required }: { required: boolean }) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        required ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
      }`}
    >
      {required ? "Required" : "Not Required"}
    </span>
  );
}

function StatusText({ row }: { row: TaskTemplateDirectoryRow }) {
  const label = templateStatusLabel(row);
  const tone =
    label === "ACTIVE" ? "text-success" : label === "INACTIVE" ? "text-task-text-muted" : "text-warning";
  return <span className={`whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider ${tone}`}>{label}</span>;
}

/**
 * The four row actions stay on one line. Letting them wrap turns every row into
 * a four-line block, which is what made the directory unreadable at real row
 * counts; the cell shrinks to its content instead so the table keeps its shape.
 */
function RowActions({
  row,
  busy,
  compact = false,
  onEdit,
  onSchedule,
  onToggle,
  onDelete,
}: {
  row: TaskTemplateDirectoryRow;
  busy: boolean;
  compact?: boolean;
  onEdit: () => void;
  onSchedule: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const activateBlocked = !row.is_active && !templateCanActivate(row);
  const style = "min-h-7 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold";
  return (
    <div className={`flex items-center gap-1 ${compact ? "flex-wrap" : "flex-nowrap"}`}>
      <Button className={style} disabled={busy} onClick={onEdit} variant="secondary">
        Edit
      </Button>
      <Button className={style} disabled={busy} onClick={onSchedule} variant="secondary">
        Schedule
      </Button>
      <Button
        className={style}
        disabled={busy || activateBlocked}
        onClick={onToggle}
        title={activateBlocked ? "Set a task start date before activating this schedule." : undefined}
        variant="secondary"
      >
        {row.is_active ? "Deactivate" : "Activate"}
      </Button>
      <Button className={style} disabled={busy} onClick={onDelete} variant="danger">
        Delete
      </Button>
    </div>
  );
}

const HEADERS = [
  "User", "Department", "Task", "Task Type", "Frequency", "Start Date", "Start", "Due", "Evidence", "Source", "Status", "Action",
] as const;

export function TemplatesTab({
  rows,
  busyId,
  onEdit,
  onSchedule,
  onToggle,
  onDelete,
}: {
  rows: readonly TaskTemplateDirectoryRow[];
  busyId: string | null;
  onEdit: (row: TaskTemplateDirectoryRow) => void;
  onSchedule: (row: TaskTemplateDirectoryRow) => void;
  onToggle: (row: TaskTemplateDirectoryRow) => void;
  onDelete: (row: TaskTemplateDirectoryRow) => void;
}) {
  const actions = (row: TaskTemplateDirectoryRow, compact = false) => (
    <RowActions
      busy={busyId === row.id}
      compact={compact}
      onDelete={() => onDelete(row)}
      onEdit={() => onEdit(row)}
      onSchedule={() => onSchedule(row)}
      onToggle={() => onToggle(row)}
      row={row}
    />
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-2xl border border-task-border lg:block">
        <table className="w-full min-w-[72rem] table-auto text-left text-xs">
          <thead className="bg-charcoal text-[10px] uppercase tracking-wider text-soft-grey">
            <tr>
              {HEADERS.map((header) => (
                <th className="whitespace-nowrap px-2 py-2 font-semibold" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t border-task-border align-middle hover:bg-gold/5" key={row.id}>
                <td className="whitespace-nowrap px-2 py-2 uppercase text-task-text">{row.assignee_name || "—"}</td>
                <td className="whitespace-nowrap px-2 py-2 uppercase text-task-text-muted">{row.department_name || "—"}</td>
                <td className="w-full min-w-64 px-2 py-2 font-semibold text-white">{row.title}</td>
                <td className="px-2 py-2">
                  <Chip tone={templateWorkTypeLabel(row) === "UPLOAD" ? "muted" : "gold"}>{templateWorkTypeLabel(row)}</Chip>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{templateFrequencyLabel(row)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{prettyDate(row.starts_on)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{prettyTime(row.planned_time)}</td>
                <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{prettyTime(row.due_time ?? row.planned_time)}</td>
                <td className="px-2 py-2"><EvidenceFlag required={row.requires_upload} /></td>
                <td className="whitespace-nowrap px-2 py-2 text-[10px] uppercase tracking-wider text-task-text-muted">{templateSourceLabel(row)}</td>
                <td className="whitespace-nowrap px-2 py-2"><StatusText row={row} /></td>
                <td className="w-px whitespace-nowrap px-2 py-2">{actions(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="p-10 text-center text-soft-grey">No templates found.</p> : null}
      </div>

      <div className="grid gap-3 lg:hidden">
        {rows.map((row) => (
          <article className="rounded-2xl border border-task-border bg-charcoal p-4" key={row.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-white">{row.title}</h3>
                <p className="mt-1 text-xs uppercase tracking-wider text-task-text-muted">
                  {row.assignee_name || "Unassigned"} · {row.department_name || "No department"}
                </p>
              </div>
              <StatusText row={row} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone={templateWorkTypeLabel(row) === "UPLOAD" ? "muted" : "gold"}>{templateWorkTypeLabel(row)}</Chip>
              <Chip tone="muted">{templateFrequencyLabel(row)}</Chip>
              <EvidenceFlag required={row.requires_upload} />
              <Chip tone="muted">{templateSourceLabel(row)}</Chip>
            </div>
            <p className="mt-3 text-xs text-task-text-muted">
              Starts {prettyDate(row.starts_on)} · {prettyTime(row.planned_time)} → {prettyTime(row.due_time ?? row.planned_time)}
            </p>
            <div className="mt-4">{actions(row, true)}</div>
          </article>
        ))}
        {rows.length === 0 ? (
          <div className="rounded-2xl border border-task-border bg-charcoal py-16 text-center">
            <ListChecks className="mx-auto size-10 text-gold" />
            <p className="mt-3 text-soft-grey">No templates found.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
