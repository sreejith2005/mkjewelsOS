import { useEffect, useState } from "react";
import { supabase } from "@jewelos/api-client";
import { prepareTaskBulkDelete, executeTaskBulkDelete, readTaskDeleteTargets, readTaskDeleteSchedules, selectTaskBulkDeleteTargets, type TaskDeleteTarget, type TaskBulkDeleteResult } from "@jewelos/data/taskControl/bulkDelete";
import { cancelFmsRun, cancelFmsStartForm } from "@jewelos/data/taskControl/fmsWork";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { fetchTaskEvidenceWorkspace } from "@/features/taskEvidence/api";
import { adminDeleteTask } from "@/features/tasks/api";
import { deleteTaskTemplate } from "@/features/taskTemplates/api";

export type BulkDeleteRequest = Readonly<{ filter: Record<string, string | number>; selected: readonly string[] | null; scopeLabel?: string }>;
export function BulkDeleteDialog({ request, onClose, onFinished }: Readonly<{ request: BulkDeleteRequest; onClose: () => void; onFinished: (result: TaskBulkDeleteResult) => Promise<void> }>) {
  const [targets, setTargets] = useState<TaskDeleteTarget[] | null>(null);
  const [series, setSeries] = useState(request.selected === null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaskBulkDeleteResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    void prepareTaskBulkDelete(request.filter, request.selected, fetchTaskEvidenceWorkspace, (ids) => readTaskDeleteTargets(supabase, ids), (filter) => readTaskDeleteSchedules(supabase, filter))
      .then((rows) => { if (!cancelled) setTargets(rows); })
      .catch((caught: unknown) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not prepare deletion."); });
    return () => { cancelled = true; };
  }, [request]);
  const chosen = targets ? selectTaskBulkDeleteTargets(targets, series) : null;
  const schedules = chosen?.filter((row) => row.kind === "template").length ?? 0;
  const fmsRuns = new Set(chosen?.flatMap((row) => row.kind === "fms_step" && row.fms_instance_id ? [row.fms_instance_id] : []) ?? []).size;
  const startForms = chosen?.filter((row) => row.kind === "fms_start").length ?? 0;
  const tasks = (chosen?.length ?? 0) - schedules - (chosen?.filter((row) => row.kind === "fms_step").length ?? 0) - startForms;
  const needsReason = fmsRuns + startForms > 0;
  const remove = async () => {
    if (!chosen?.length || busy || result || (needsReason && !reason.trim())) return;
    setBusy(true);
    try {
      const next = await executeTaskBulkDelete(chosen, series, reason, adminDeleteTask, setProgress, deleteTaskTemplate,
        (target, why) => target.kind === "fms_step" && target.fms_instance_id ? cancelFmsRun(target.fms_instance_id, why) : cancelFmsStartForm(target.id, why));
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
        {result.succeeded.length} of {chosen?.length ?? 0} work selections processed.
        {result.failed.length ? ` ${result.failed.length} remain for retry. Tasks remain selected; use Delete all matching to include remaining schedules. ${result.failed[0]?.message ?? ""}` : ""}
        {series && chosen?.some((row) => row.task_template_id) ? " Completed history and evidence were preserved." : ""}
      </Notice> : targets ? <>
        <p className="font-semibold">{[tasks ? `${tasks} task(s)` : "", schedules ? `${schedules} schedule(s)` : "", fmsRuns ? `${fmsRuns} FMS run(s)` : "", startForms ? `${startForms} FMS start form(s)` : ""].filter(Boolean).join(", ") || "Nothing"} selected for deletion.</p>
        {needsReason ? <Notice>Each selected FMS step cancels its whole FMS run (completed steps and history are kept); start forms are removed for that person only. A reason is required.</Notice> : null}
        {targets.some((row) => row.task_template_id) ? <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy} checked={series} onChange={(event) => setSeries(event.target.checked)} />Delete entire recurring series</label> : null}
        <Notice>{series ? "Also removes unfinished occurrences outside the date/status view and stops future generation. Delete all includes matching inactive and not-yet-generated schedules; schedule scope follows employee, branch, department, search and work type. Completed history and evidence are preserved." : "Deletes the selected occurrences only. Recurring schedules continue creating future tasks."}</Notice>
        <Field label={needsReason ? "Reason (required)" : "Reason (optional)"}><textarea disabled={busy} maxLength={1000} className="task-field" value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      </> : !error ? <p role="status">Preparing all matching tasks…</p> : null}
      {busy ? <p role="status">Processing {progress} of {chosen?.length ?? 0} selections…</p> : null}
      <div className="flex gap-2">
        <Button disabled={busy} variant="secondary" onClick={onClose}>{result ? "Close" : "Cancel"}</Button>
        {!result ? <Button disabled={busy || !chosen?.length || Boolean(error) || (needsReason && !reason.trim())} variant="danger" onClick={() => void remove()}>Confirm deletion</Button> : null}
      </div>
    </div>
  </Modal>;
}
