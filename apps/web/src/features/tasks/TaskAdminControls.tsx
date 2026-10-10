import { useState } from "react";
import { taskAdminInitialEdit, type TaskAdminEdit } from "@jewelos/core";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { adminDeleteTask, adminEditTask } from "./api";

type ManagedTask = Parameters<typeof taskAdminInitialEdit>[0] & Readonly<{ id: string | null; task_template_id: string | null }>;

export function TaskAdminControls({ task, onChanged }: Readonly<{ task: ManagedTask; onChanged: () => Promise<void> }>) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [edit, setEdit] = useState<TaskAdminEdit>(() => taskAdminInitialEdit(task));
  const [series, setSeries] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (next: "edit" | "delete") => { setEdit(taskAdminInitialEdit(task)); setSeries(false); setReason(""); setError(null); setMode(next); };
  const save = async () => {
    if (!task.id || busy) return;
    setBusy(true); setError(null);
    try {
      if (mode === "edit") await adminEditTask(task.id, edit);
      else await adminDeleteTask(task.id, series, reason);
      setMode(null); await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task change failed"); }
    finally { setBusy(false); }
  };
  return <>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => open("edit")}>Edit task</Button>
      <Button variant="danger" onClick={() => open("delete")}>Delete task</Button>
    </div>
    {mode ? <Modal title={mode === "edit" ? "Edit task" : "Delete task"} onClose={() => { if (!busy) setMode(null); }}>
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {mode === "edit" ? <>
          <Field label="Title"><input required maxLength={300} className="task-field" value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} /></Field>
          <Field label="Description"><textarea maxLength={10000} className="task-field" value={edit.description} onChange={(event) => setEdit({ ...edit, description: event.target.value })} /></Field>
          <Field label="Priority"><select className="task-field" value={edit.priority} onChange={(event) => { const priority = event.target.value; if (priority === "low" || priority === "medium" || priority === "high") setEdit({ ...edit, priority }); }}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
          <Field label="Start (India time)"><input required type="datetime-local" className="task-field" value={edit.planned} onChange={(event) => setEdit({ ...edit, planned: event.target.value })} /></Field>
          <Field label="Due (India time)"><input required type="datetime-local" className="task-field" value={edit.due} onChange={(event) => setEdit({ ...edit, due: event.target.value })} /></Field>
          {task.task_template_id ? <p className="text-sm text-task-text-muted">This edits this occurrence. Change future schedules in <a className="text-task-accent underline" href="/recurring-todo">Recurring / To-Do</a>.</p> : null}
        </> : <>
          <p>Delete “{task.title}” from active work?</p>
          {task.task_template_id ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={series} onChange={(event) => setSeries(event.target.checked)} />Delete entire recurring series</label> : null}
          <Notice>{series ? "Stops future generation and removes all unfinished occurrences. Completed history and evidence are preserved." : "Removes this occurrence. A recurring schedule will continue generating its future tasks."}</Notice>
          <Field label="Reason (optional)"><textarea maxLength={1000} className="task-field" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        </>}
        <div className="flex gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => setMode(null)}>Cancel</Button><Button type="submit" variant={mode === "delete" ? "danger" : "primary"} disabled={busy}>{mode === "edit" ? "Save changes" : "Confirm deletion"}</Button></div>
      </form>
    </Modal> : null}
  </>;
}
