import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ListChecks, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import type { Json } from "@jewelos/core";
import { supabase } from "@jewelos/api-client";
import { useAuth } from "@/auth/AuthContext";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { TaskTemplateForm } from "@/features/tasks/TaskForms";
import { loadTaskAuthoringReferenceData, type TaskReferenceData, type TaskTemplate } from "@/features/tasks/api";
import { materializeRecurringTemplate, saveRecurringTemplate, setRecurringTemplateActive } from "@/features/recurringTodo/api";
import {
  deleteTaskTemplate,
  loadTaskTemplateDirectory,
  setTaskTemplateSchedule,
  templateCanActivate,
  templateFrequencyLabel,
  templateSourceLabel,
  templateStatusLabel,
  templateWorkTypeLabel,
  type TaskTemplateDirectoryRow,
} from "@/features/taskTemplates/api";
import { errorMessage } from "@/lib/format";

function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function prettyDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00+05:30`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function prettyTime(value: string | null): string {
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

export function TaskTemplatesPage() {
  const { profile } = useAuth();
  const authorized = profile ? ["super_admin", "admin"].includes(profile.user_role) : false;
  const [rows, setRows] = useState<TaskTemplateDirectoryRow[]>([]);
  const [references, setReferences] = useState<TaskReferenceData | null>(null);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskTemplate | null | undefined>(undefined);
  const [scheduling, setScheduling] = useState<TaskTemplateDirectoryRow | null>(null);
  const [scheduleDate, setScheduleDate] = useState(todayKey());

  const load = useCallback(async () => {
    if (!authorized) return;
    setLoading(true);
    setError(null);
    try {
      const [directory, nextReferences] = await Promise.all([
        loadTaskTemplateDirectory({ search }),
        loadTaskAuthoringReferenceData(),
      ]);
      setRows(directory.templates);
      setReferences(nextReferences);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [authorized, search]);

  useEffect(() => {
    void load();
  }, [load]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["tasks", "organization"], refresh: load });

  const departments = useMemo(
    () => [...new Set(rows.map((row) => row.department_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const users = useMemo(
    () => [...new Set(rows.map((row) => row.assignee_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!departmentFilter || row.department_name === departmentFilter) &&
          (!userFilter || row.assignee_name === userFilter),
      ),
    [departmentFilter, rows, userFilter],
  );

  const run = async (row: TaskTemplateDirectoryRow, action: () => Promise<void>) => {
    setBusyId(row.id);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      toast.error(message);
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = async (row: TaskTemplateDirectoryRow) => {
    setBusyId(row.id);
    setError(null);
    const { data, error: loadError } = await supabase.from("task_templates").select("*").eq("id", row.id).maybeSingle();
    setBusyId(null);
    if (loadError || !data) {
      const message = loadError ? loadError.message : "This task template is no longer available.";
      setError(message);
      toast.error(message);
      return;
    }
    setEditing(data);
  };

  const save = async (id: string | null, payload: Json) => {
    const templateId = await saveRecurringTemplate(id, payload);
    await materializeRecurringTemplate(templateId, payload);
    setEditing(undefined);
    toast.success(id ? "Task template updated" : "Task added successfully");
    await load();
  };

  const toggle = (row: TaskTemplateDirectoryRow) =>
    void run(row, async () => {
      await setRecurringTemplateActive(row.id, !row.is_active);
      toast.success(row.is_active ? "Template deactivated" : "Template activated");
    });

  const remove = (row: TaskTemplateDirectoryRow) => {
    const confirmed = window.confirm(
      `Delete this task template: ${row.title}?\n\nPending, in-progress and overdue occurrences will also be removed. Completed work and history will be preserved.`,
    );
    if (!confirmed) return;
    void run(row, async () => {
      const result = await deleteTaskTemplate(row.id);
      toast.success(
        result.outcome === "deleted"
          ? `Task deleted. ${result.open_instances_removed} open occurrence(s) removed.`
          : `Task archived. ${result.open_instances_removed} open occurrence(s) removed, ${result.instances_preserved} completed record(s) preserved.`,
      );
    });
  };

  const openSchedule = (row: TaskTemplateDirectoryRow) => {
    setScheduleDate(row.starts_on ?? todayKey());
    setScheduling(row);
  };

  const saveSchedule = async () => {
    if (!scheduling) return;
    const row = scheduling;
    if (!scheduleDate) {
      toast.error("Select a start date.");
      return;
    }
    setScheduling(null);
    await run(row, async () => {
      await setTaskTemplateSchedule(row.id, scheduleDate);
      await materializeRecurringTemplate(row.id);
      toast.success("Schedule saved");
    });
  };

  if (!authorized) return <Notice tone="danger">Task Templates is available only to administrators.</Notice>;

  const headers = [
    "User",
    "Department",
    "Task",
    "Task Type",
    "Frequency",
    "Start Date",
    "Start",
    "Due",
    "Evidence",
    "Source",
    "Status",
    "Action",
  ];

  return (
    <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg pb-24 text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)] md:pb-10">
      <header className="border-b border-task-border bg-charcoal px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-[100rem] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-gold p-2.5 text-obsidian">
              <ListChecks className="size-5" />
            </span>
            <div>
              <h1 className="font-display text-3xl text-gold">Task Templates</h1>
              <p className="text-sm text-soft-grey">Recurring rules, schedules and source-linked task templates.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setEditing(null)}>
              <Plus className="size-4" />
              Add Task
            </Button>
            <Button onClick={() => void load()} variant="secondary">
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[100rem] space-y-4 p-4 sm:p-6">
        {error ? <Notice tone="danger">{error}</Notice> : null}

        <div className="grid gap-3 rounded-2xl border border-task-border bg-charcoal p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label="Department Filter">
            <select
              className="task-field"
              onChange={(event) => setDepartmentFilter(event.target.value)}
              value={departmentFilter}
            >
              <option value="">All Departments</option>
              {departments.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="User Filter">
            <select className="task-field" onChange={(event) => setUserFilter(event.target.value)} value={userFilter}>
              <option value="">All Users</option>
              {users.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Search">
            <span className="relative block">
              <Search className="absolute left-3 top-3 size-4 text-task-text-muted" />
              <input
                className="task-field pl-9"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Task, user or department"
                value={search}
              />
            </span>
          </Field>
          <div className="flex items-end">
            <Button
              className="w-full md:w-auto"
              onClick={() => {
                setDepartmentFilter("");
                setUserFilter("");
                setSearch("");
              }}
              variant="secondary"
            >
              Reset
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="py-16 text-center text-gold">Loading task templates…</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-2xl border border-task-border lg:block">
              <table className="w-full min-w-[72rem] table-auto text-left text-xs">
                <thead className="bg-charcoal text-[10px] uppercase tracking-wider text-soft-grey">
                  <tr>
                    {headers.map((header) => (
                      <th className="whitespace-nowrap px-2 py-2 font-semibold" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr className="border-t border-task-border align-middle hover:bg-gold/5" key={row.id}>
                      <td className="whitespace-nowrap px-2 py-2 uppercase text-task-text">{row.assignee_name || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-2 uppercase text-task-text-muted">{row.department_name || "—"}</td>
                      <td className="w-full min-w-64 px-2 py-2 font-semibold text-white">{row.title}</td>
                      <td className="px-2 py-2">
                        <Chip tone={templateWorkTypeLabel(row) === "UPLOAD" ? "muted" : "gold"}>
                          {templateWorkTypeLabel(row)}
                        </Chip>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{templateFrequencyLabel(row)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{prettyDate(row.starts_on)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{prettyTime(row.planned_time)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">
                        {prettyTime(row.due_time ?? row.planned_time)}
                      </td>
                      <td className="px-2 py-2">
                        <EvidenceFlag required={row.requires_upload} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-[10px] uppercase tracking-wider text-task-text-muted">
                        {templateSourceLabel(row)}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <StatusText row={row} />
                      </td>
                      <td className="w-px whitespace-nowrap px-2 py-2">
                        <RowActions
                          busy={busyId === row.id}
                          onDelete={() => remove(row)}
                          onEdit={() => void openEdit(row)}
                          onSchedule={() => openSchedule(row)}
                          onToggle={() => toggle(row)}
                          row={row}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 ? <p className="p-10 text-center text-soft-grey">No templates found.</p> : null}
            </div>

            <div className="grid gap-3 lg:hidden">
              {visible.map((row) => (
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
                    <Chip tone={templateWorkTypeLabel(row) === "UPLOAD" ? "muted" : "gold"}>
                      {templateWorkTypeLabel(row)}
                    </Chip>
                    <Chip tone="muted">{templateFrequencyLabel(row)}</Chip>
                    <EvidenceFlag required={row.requires_upload} />
                    <Chip tone="muted">{templateSourceLabel(row)}</Chip>
                  </div>
                  <p className="mt-3 text-xs text-task-text-muted">
                    Starts {prettyDate(row.starts_on)} · {prettyTime(row.planned_time)} →{" "}
                    {prettyTime(row.due_time ?? row.planned_time)}
                  </p>
                  <div className="mt-4">
                    <RowActions
                      busy={busyId === row.id}
                      compact
                      onDelete={() => remove(row)}
                      onEdit={() => void openEdit(row)}
                      onSchedule={() => openSchedule(row)}
                      onToggle={() => toggle(row)}
                      row={row}
                    />
                  </div>
                </article>
              ))}
              {visible.length === 0 ? (
                <div className="rounded-2xl border border-task-border bg-charcoal py-16 text-center">
                  <ListChecks className="mx-auto size-10 text-gold" />
                  <p className="mt-3 text-soft-grey">No templates found.</p>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      {editing !== undefined && references ? (
        <Modal onClose={() => setEditing(undefined)} title={editing ? "Edit task template" : "Add new task"} wide>
          <TaskTemplateForm data={references} onCancel={() => setEditing(undefined)} onSave={save} template={editing} />
        </Modal>
      ) : null}

      {scheduling ? (
        <Modal onClose={() => setScheduling(null)} title="Task schedule">
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm text-task-text-muted">
              <CalendarDays className="size-4 text-gold" />
              {[scheduling.assignee_name, scheduling.title, templateFrequencyLabel(scheduling)]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <Field label="Task start date">
              <input
                className="task-field"
                onChange={(event) => setScheduleDate(event.target.value)}
                type="date"
                value={scheduleDate}
              />
            </Field>
            <Notice tone="task">
              Recurring schedules continue automatically from this date until the template is deactivated.
            </Notice>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setScheduling(null)} variant="secondary">
                Cancel
              </Button>
              <Button onClick={() => void saveSchedule()}>Save schedule</Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {busyId ? (
        <p className="sr-only" role="status">
          Working…
        </p>
      ) : null}
    </section>
  );
}
