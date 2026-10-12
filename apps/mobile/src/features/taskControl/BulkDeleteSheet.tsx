import { useState } from "react";
import { getSupabase } from "@jewelos/api-client/client";
import { prepareTaskBulkDelete, executeTaskBulkDelete, readTaskDeleteTargets, readTaskDeleteSchedules, selectTaskBulkDeleteTargets, type TaskBulkDeleteResult } from "@jewelos/data/taskControl/bulkDelete";
import { fetchTaskEvidenceWorkspace } from "@jewelos/data/taskEvidence/api";
import { adminDeleteTask } from "@jewelos/data/tasks/api";
import { deleteTaskTemplate } from "@jewelos/data/taskTemplates/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { ToggleField } from "@/forms/ToggleField";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Sheet } from "@/ui/Sheet";
import { Banner, LoadingState } from "@/ui/states";

export type BulkDeleteRequest = Readonly<{ filter: Record<string, string | number>; selected: readonly string[] | null; scopeLabel?: string }>;
export function BulkDeleteSheet({ request, onClose, onFinished }: Readonly<{ request: BulkDeleteRequest; onClose: () => void; onFinished: (result: TaskBulkDeleteResult) => Promise<void> }>) {
  const state = useAsyncData(() => prepareTaskBulkDelete(request.filter, request.selected, fetchTaskEvidenceWorkspace, (ids) => readTaskDeleteTargets(getSupabase(), ids), (filter) => readTaskDeleteSchedules(getSupabase(), filter)), [request]);
  const [series, setSeries] = useState(request.selected === null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaskBulkDeleteResult | null>(null);
  const chosen = state.data ? selectTaskBulkDeleteTargets(state.data, series) : null;
  const schedules = chosen?.filter((row) => row.kind === "template").length ?? 0;
  const remove = async () => {
    if (!chosen?.length || busy || result) return;
    setBusy(true);
    try {
      const next = await executeTaskBulkDelete(chosen, series, reason, adminDeleteTask, setProgress, deleteTaskTemplate);
      setResult(next);
      await onFinished(next);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not refresh tasks."); }
    finally { setBusy(false); }
  };
  return <Sheet visible tall title={request.selected === null ? "Delete all matching tasks" : "Delete selected tasks"} onClose={() => { if (!busy) onClose(); }}>
    {request.scopeLabel ? <Text weight="semibold">{request.scopeLabel}</Text> : null}
    <Text>{`${request.filter.from} to ${request.filter.to}. ${request.selected === null ? "All matches across every page, using the current employee, scope, search and view filters." : "Only your selected tasks."}`}</Text>
    {state.error || error ? <Banner tone="danger">{state.error ?? error ?? ""}</Banner> : null}
    {state.loading ? <LoadingState label="Preparing matching tasks..." /> : null}
    {result ? <Banner tone={result.failed.length ? "danger" : "success"}>
      {`${result.succeeded.length} of ${chosen?.length ?? 0} work selections processed. ${result.failed.length ? `${result.failed.length} remain for retry. Tasks remain selected; use Delete all matching to include remaining schedules. ${result.failed[0]?.message ?? ""}` : ""}${series ? " Completed history and evidence were preserved." : ""}`}
    </Banner> : state.data ? <>
      <Text weight="semibold">{schedules ? `${(chosen?.length ?? 0) - schedules} task occurrence(s) and ${schedules} schedule(s) selected for deletion.` : `${chosen?.length ?? 0} task(s) selected for deletion.`}</Text>
      {state.data.some((row) => row.task_template_id) ? <ToggleField disabled={busy} required={false} label="Delete entire recurring series" value={series} onChange={setSeries} /> : null}
      <Banner tone="warning">{series ? "Also removes unfinished occurrences outside the date/status view and stops future generation. Delete all includes matching inactive and not-yet-generated schedules; schedule scope follows employee, branch, department, search and work type. Completed history and evidence are preserved." : "Deletes the selected occurrences only. Recurring schedules continue creating future tasks."}</Banner>
      <TextField editable={!busy} label="Reason (optional)" multiline maxLength={1000} value={reason} onChangeText={setReason} />
    </> : null}
    {busy ? <Text>{`Processing ${progress} of ${chosen?.length ?? 0} selections...`}</Text> : null}
    <Button disabled={busy} label={result ? "Close" : "Cancel"} variant="secondary" onPress={onClose} />
    {!result ? <Button disabled={busy || !chosen?.length || Boolean(state.error || error)} busy={busy} label="Confirm deletion" variant="danger" onPress={() => void remove()} /> : null}
  </Sheet>;
}
