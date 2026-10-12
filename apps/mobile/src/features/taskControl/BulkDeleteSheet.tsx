import { useState } from "react";
import { getSupabase } from "@jewelos/api-client/client";
import { prepareTaskBulkDelete, executeTaskBulkDelete, readTaskDeleteTargets, type TaskBulkDeleteResult } from "@jewelos/data/taskControl/bulkDelete";
import { fetchTaskEvidenceWorkspace } from "@jewelos/data/taskEvidence/api";
import { adminDeleteTask } from "@jewelos/data/tasks/api";
import { useAsyncData } from "@/lib/useAsyncData";
import { ToggleField } from "@/forms/ToggleField";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Sheet } from "@/ui/Sheet";
import { Banner, LoadingState } from "@/ui/states";

export type BulkDeleteRequest = Readonly<{ filter: Record<string, string | number>; selected: readonly string[] | null; scopeLabel?: string }>;
export function BulkDeleteSheet({ request, onClose, onFinished }: Readonly<{ request: BulkDeleteRequest; onClose: () => void; onFinished: (result: TaskBulkDeleteResult) => Promise<void> }>) {
  const state = useAsyncData(() => prepareTaskBulkDelete(request.filter, request.selected, fetchTaskEvidenceWorkspace, (ids) => readTaskDeleteTargets(getSupabase(), ids)), [request]);
  const [series, setSeries] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaskBulkDeleteResult | null>(null);
  const remove = async () => {
    if (!state.data?.length || busy || result) return;
    setBusy(true);
    try {
      const next = await executeTaskBulkDelete(state.data, series, reason, adminDeleteTask, setProgress);
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
      {`${result.succeeded.length} of ${state.data?.length ?? 0} task selections processed. ${result.failed.length ? `${result.failed.length} remain selected for retry. ${result.failed[0]?.message ?? ""}` : ""}${series ? " Completed history and evidence were preserved." : ""}`}
    </Banner> : state.data ? <>
      <Text weight="semibold">{`${state.data.length} task(s) selected for deletion.`}</Text>
      {state.data.some((row) => row.task_template_id) ? <ToggleField disabled={busy} required={false} label="Delete entire recurring series" value={series} onChange={setSeries} /> : null}
      <Banner tone="warning">{series ? "Also removes unfinished occurrences outside these filters and stops future generation. Completed history and evidence are preserved." : "Deletes the selected occurrences only. Recurring schedules continue creating future tasks."}</Banner>
      <TextField editable={!busy} label="Reason (optional)" multiline maxLength={1000} value={reason} onChangeText={setReason} />
    </> : null}
    {busy ? <Text>{`Processing ${progress} of ${state.data?.length ?? 0} selections...`}</Text> : null}
    <Button disabled={busy} label={result ? "Close" : "Cancel"} variant="secondary" onPress={onClose} />
    {!result ? <Button disabled={busy || !state.data?.length || Boolean(state.error || error)} busy={busy} label="Confirm deletion" variant="danger" onPress={() => void remove()} /> : null}
  </Sheet>;
}
