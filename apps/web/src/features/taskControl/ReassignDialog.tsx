import { useEffect, useMemo, useState } from "react";
import { planReassignAll, planReassignSelected, reassignPlanSize, type ReassignCandidates, type ReassignSkipped } from "@jewelos/core";
import { executeReassignPlan, loadReassignCandidates, loadReassignSources, type ReassignSourcePerson } from "@jewelos/data/taskControl/reassign";
import { loadTaskAssignmentUsers } from "@jewelos/data/tasks/api";
import { AssigneePicker, type AssigneePerson } from "@/components/assignees/AssigneePicker";
import { Button, Field, Modal, Notice } from "@/components/ui";

export type ReassignRequest = Readonly<{ selectedIds: readonly string[] | null; fromUserId: string }>;

type Props = Readonly<{
  request: ReassignRequest;
  branchNames: ReadonlyMap<string, string>;
  departmentNames: ReadonlyMap<string, string>;
  onClose: () => void;
  onFinished: () => Promise<void>;
}>;

type Outcome = Readonly<{ moved: number; skipped: ReassignSkipped[]; error: string | null }>;

/**
 * Moves one person's work to someone else: the selected rows, or all of their
 * open work (every date). The server checks each item and reports any that
 * could not move; the new person gets one summary notification.
 */
export function ReassignDialog({ request, branchNames, departmentNames, onClose, onFinished }: Props) {
  const selectedMode = request.selectedIds !== null;
  const [sources, setSources] = useState<ReassignSourcePerson[]>([]);
  const [receivers, setReceivers] = useState<AssigneePerson[]>([]);
  const [fromId, setFromId] = useState(request.fromUserId);
  const [toId, setToId] = useState("");
  const [candidates, setCandidates] = useState<ReassignCandidates | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [options, setOptions] = useState({ upcoming: true, overdue: true, fmsSteps: true, schedules: true });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    void loadReassignSources().then(setSources).catch(() => setSources([]));
    void loadTaskAssignmentUsers().then((users) => setReceivers(users.flatMap((user) => user.id ? [{ ...user, id: user.id }] : []))).catch(() => setReceivers([]));
  }, []);

  useEffect(() => {
    setCandidates(null); setLoadError(null);
    if (!fromId) return;
    let cancelled = false;
    void loadReassignCandidates(fromId)
      .then((next) => { if (!cancelled) setCandidates(next); })
      .catch((caught: unknown) => { if (!cancelled) setLoadError(caught instanceof Error ? caught.message : "Could not load this person's work."); });
    return () => { cancelled = true; };
  }, [fromId]);

  const plan = useMemo(() => !candidates ? null : request.selectedIds === null
    ? planReassignAll(candidates, options)
    : planReassignSelected(candidates, request.selectedIds, options.schedules), [candidates, options, request.selectedIds]);
  const total = plan ? reassignPlanSize(plan) : 0;
  const overdueCount = candidates?.tasks.filter((task) => task.overdue).length ?? 0;
  const upcomingCount = (candidates?.tasks.length ?? 0) - overdueCount;
  const notTheirs = selectedMode && candidates && request.selectedIds
    ? request.selectedIds.filter((id) => !candidates.tasks.some((task) => task.id === id) && !candidates.fms_steps.some((step) => step.id === id)).length : 0;
  const selectedSchedules = selectedMode && candidates && request.selectedIds
    ? new Set(candidates.tasks.flatMap((task) => request.selectedIds?.includes(task.id) && task.task_template_id && candidates.schedules.some((schedule) => schedule.id === task.task_template_id) ? [task.task_template_id] : [])).size : 0;
  const titles = useMemo(() => new Map([...(candidates?.tasks ?? []), ...(candidates?.fms_steps ?? []), ...(candidates?.schedules ?? [])].map((item) => [item.id, item.title])), [candidates]);
  const fromLabel = sources.find((person) => person.id === fromId)?.label ?? "this person";

  const run = async () => {
    if (!plan || !total || !toId || !reason.trim() || busy) return;
    setBusy(true); setProgress(0);
    try {
      const result = await executeReassignPlan(fromId, toId, reason.trim(), plan, (done) => setProgress(done));
      setOutcome({ moved: result.moved.length, skipped: result.skipped, error: result.error });
      await onFinished();
    } catch (caught) {
      setOutcome({ moved: 0, skipped: [], error: caught instanceof Error ? caught.message : "The work could not be moved." });
    } finally { setBusy(false); }
  };

  const toggle = (key: keyof typeof options) => setOptions((value) => ({ ...value, [key]: !value[key] }));
  const check = (key: keyof typeof options, label: string) => <label className="flex min-h-11 items-center gap-2 text-sm"><input checked={options[key]} disabled={busy} onChange={() => toggle(key)} type="checkbox" />{label}</label>;

  return <Modal title={selectedMode ? "Reassign selected tasks" : "Reassign all open work"} onClose={() => { if (!busy) onClose(); }}>
    <div className="space-y-4">
      {outcome ? <>
        {outcome.error ? <Notice tone="danger">{outcome.error}</Notice> : null}
        <Notice tone={outcome.skipped.length || outcome.error ? "neutral" : "success"}>{outcome.moved} item(s) moved. {outcome.moved ? "The new person was sent one notification." : ""}</Notice>
        {outcome.skipped.length ? <div className="space-y-1 text-sm">
          <p className="font-semibold">{outcome.skipped.length} could not be moved:</p>
          <ul className="list-disc space-y-1 pl-5">{outcome.skipped.slice(0, 20).map((item) => <li key={item.id}>{titles.get(item.id) ?? "Selected item"}: {item.reason}</li>)}</ul>
          {outcome.skipped.length > 20 ? <p className="text-task-text-muted">…and {outcome.skipped.length - 20} more.</p> : null}
        </div> : null}
        <Button onClick={onClose}>Close</Button>
      </> : <>
        <Field label="Move work from">
          <select className="task-field" disabled={busy || selectedMode && Boolean(request.fromUserId)} onChange={(event) => { setFromId(event.target.value); setToId(""); }} value={fromId}>
            <option value="">Choose an employee</option>
            {sources.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
          </select>
        </Field>
        {loadError ? <Notice tone="danger">{loadError}</Notice> : null}
        {fromId && !candidates && !loadError ? <p role="status" className="text-sm">Loading {fromLabel}'s work…</p> : null}
        {candidates ? selectedMode ? <div className="space-y-1">
          <p className="text-sm">{total} item(s) will move.{notTheirs ? ` ${notTheirs} selected item(s) are finished or not ${fromLabel}'s work and stay as they are.` : ""}</p>
          {selectedSchedules ? check("schedules", `Also move the recurring schedule${selectedSchedules === 1 ? "" : "s"} of these tasks (${selectedSchedules}), so future tasks go to the new person`) : null}
        </div> : <div className="rounded-xl border border-task-border p-3">
          <p className="mb-1 text-sm font-semibold">What to move</p>
          {check("upcoming", `Open tasks due today or later (${upcomingCount})`)}
          {check("overdue", `Overdue tasks (${overdueCount})`)}
          {check("fmsSteps", `Open FMS steps (${candidates.fms_steps.length})`)}
          {check("schedules", `Recurring schedules (${candidates.schedules.length}): future tasks go to the new person`)}
          <p className="mt-1 text-xs text-task-text-muted">Every date is included, not only the dates in the Task Control filter. Completed work stays with {fromLabel}.</p>
        </div> : null}
        {candidates ? <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="Move work to" multiple={false} onChange={(ids) => setToId(ids[0] ?? "")} people={receivers.filter((person) => person.id !== fromId)} selectedIds={toId ? [toId] : []} /> : null}
        {candidates ? <Field label="Reason (required)"><textarea className="task-field" disabled={busy} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="For example: Priya left the company" value={reason} /></Field> : null}
        {busy ? <p role="status" className="text-sm">Moving {progress} of {total}…</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !total || !toId || !reason.trim()} onClick={() => void run()}>{total ? `Reassign ${total} item${total === 1 ? "" : "s"}` : "Nothing to reassign"}</Button>
        </div>
      </>}
    </div>
  </Modal>;
}
