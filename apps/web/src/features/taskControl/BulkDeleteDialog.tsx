import { useEffect, useState } from "react";
import { supabase } from "@jewelos/api-client";
import { prepareTaskBulkDelete, executeTaskBulkDelete, readTaskDeleteTargets, type TaskDeleteTarget, type TaskBulkDeleteResult } from "@jewelos/data/taskControl/bulkDelete";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { fetchTaskEvidenceWorkspace } from "@/features/taskEvidence/api";
import { adminDeleteTask } from "@/features/tasks/api";

export type BulkDeleteRequest = Readonly<{ filter: Record<string, string | number>; selected: readonly string[] | null; scopeLabel?: string }>;
export function BulkDeleteDialog({ request, onClose, onFinished }: Readonly<{ request: BulkDeleteRequest; onClose: () => void; onFinished: (result: TaskBulkDeleteResult) => Promise<void> }>) {
  const [targets, setTargets] = useState<TaskDeleteTarget[] | null>(null);
  const [series, setSeries] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaskBulkDeleteResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    void prepareTaskBulkDelete(request.filter, request.selected, fetchTaskEvidenceWorkspace, (ids) => readTaskDeleteTargets(supabase, ids))
      .then((rows) => { if (!cancelled) setTargets(rows); })
      .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not prepare deletion."); });
    return () => { cancelled = true; };
  }, [request]);
  const remove = async () => {
    if (!targets?.length || busy || result) return;
    setBusy(true);
    try {
      const next = await executeTaskBulkDelete(targets, series, reason, adminDeleteTask, setProgress);
      setResult(next);
      await onFinished(next);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not refresh tasks."); }
    finally { setBusy(false); }
  };
  return <Modal title={request.selected === null ? "Delete all matching tasks" : "Delete selected tasks"} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4">
      {request.scopeLabel ? <p className="font-semibold">{request.scopeLabel}</p> : null}
      <p className="text-sm">{request.filter.from} to {request.filter.to}. {request.selected === null ? "All tasks matching the employee, scope, search and view filters, across every page." : "Only your selected tasks."}</p>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {result ? <Notice tone={result.failed.length ? "danger" : "task"}>
        {result.succeeded.length} of {targets?.length ?? 0} task selections processed.
        {result.failed.length ? ` ${result.failed.length} remain selected for retry. ${result.failed[0]?.message ?? ""}` : ""}
        {series ? " Completed history and evidence were preserved." : ""}
      </Notice> : targets ? <>
        <p className="font-semibold">{targets.length} task(s) selected for deletion.</p>
        {targets.some((row) => row.task_template_id) ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy} checked={series} onChange={(event) => setSeries(event.target.checked)} />Delete entire recurring series</label> : null}
        <Notice>{series ? "Also removes unfinished occurrences outside these filters and stops future generation. Completed history and evidence are preserved." : "Deletes the selected occurrences only. Recurring schedules continue creating future tasks."}</Notice>
        <Field label="Reason (optional)"><textarea disabled={busy} maxLength={1000} className="task-field" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      </> : !error ? <p role="status">Preparing all matching tasks…</p> : null}
      {busy ? <p role="status">Processing {progress} of {targets?.length ?? 0} selections…</p> : null}
      <div className="flex gap-2">
        <Button disabled={busy} variant="secondary" onClick={onClose}>{result ? "Close" : "Cancel"}</Button>
        {!result ? <Button disabled={busy || !targets?.length || Boolean(error)} variant="danger" onClick={() => void remove()}>Confirm deletion</Button> : null}
      </div>
    </div>
  </Modal>;
}
