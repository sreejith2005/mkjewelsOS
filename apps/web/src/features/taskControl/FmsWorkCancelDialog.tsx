import { useState } from "react";
import { cancelTaskControlFmsWork } from "@jewelos/data/taskControl/fmsWork";
import { Button, Field, Modal, Notice } from "@/components/ui";
import type { TaskRow } from "@/features/taskEvidence/types";

/**
 * FMS work is removed through its own audited contracts: a step cancels the whole
 * FMS run (its completed steps and history stay), a start form cancels only that
 * person's pending start form.
 */
export function FmsWorkCancelDialog({ row, kind, onClose, onDone }: Readonly<{
  row: TaskRow; kind: "fms_step" | "fms_start"; onClose: () => void; onDone: () => Promise<void>;
}>) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = kind === "fms_start";
  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await cancelTaskControlFmsWork(kind, row.task_id, reason); await onDone(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not cancel this FMS work."); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={start ? "Delete FMS start form" : "Delete FMS task"} onClose={() => { if (!busy) onClose(); }}>
      <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <p className="text-sm">
          <span className="font-semibold">{row.task_title}</span>
          {row.work_context ? <span className="block text-xs text-task-text-muted">{row.work_context}</span> : null}
        </p>
        <Notice>
          {start
            ? `Removes this start form from ${row.assignee_names ?? "the assignee"}'s work. Other people's start forms and the workflow itself are not changed.`
            : "Cancels this whole FMS run, so none of its remaining steps stay open for anyone. Completed steps, submitted forms and history are kept."}
        </Notice>
        <Field label="Reason (required)"><textarea required maxLength={1000} className="task-field" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={busy || !reason.trim()}>{busy ? "Deleting…" : "Confirm deletion"}</Button>
        </div>
      </form>
    </Modal>
  );
}
