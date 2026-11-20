import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  AI_INTENT_LABEL, CRM_RESULT_LABEL, DAY_HALF_LABELS, FOLLOW_UP_CHANNEL_LABEL, FOLLOW_UP_CHANNELS,
  fmsAssignedWorkPath, readinessItems, type ConversationIntegration, type DayHalf, type FollowUpChannel, type FollowUpView, type ReadinessTone, type Suggestion,
} from "@jewelos/core";
import { createFollowUp, fetchFollowUpOptions, WorkspaceError } from "@jewelos/data";
import { Button, Notice } from "@/components/ui";
import { Panel, Tag } from "./ui";
import { useLoad } from "./useLoad";

const message = (cause: unknown, fallback: string) => cause instanceof WorkspaceError && cause.message ? cause.message : fallback;
const istDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const istDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
/** Today's India date, YYYY-MM-DD, for the due-day picker. */
const indiaToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const TONE: Readonly<Record<ReadinessTone, "success" | "progress" | "attention" | "neutral">> = { ok: "success", waiting: "progress", problem: "attention", idle: "neutral" };

// ---------------------------------------------------------------------------
/** The AI's reading and the CRM's record, side by side and never merged. */
export function OutcomeStrip({ integration }: { integration: ConversationIntegration }) {
  const crm = integration.outcome.crm;
  return <div className="flex flex-wrap items-center gap-2" aria-label="Outcome">
    <Tag>{AI_INTENT_LABEL[integration.outcome.ai]}</Tag>
    <Tag tone={crm.state === "crm_confirmed_purchase" ? "success" : crm.state === "pending_crm_confirmation" ? "neutral" : "progress"}>
      {CRM_RESULT_LABEL[crm.state]}{crm.purchase_visit_at ? ` · ${istDate(crm.purchase_visit_at)}` : ""}
    </Tag>
  </div>;
}

/** One line per integration, scoped to what this person may see. */
export function ReadinessStrip({ integration }: { integration: ConversationIntegration }) {
  return <ul aria-label="Integration status" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {readinessItems(integration.readiness).map((item) => <li className="rounded-xl border border-task-border px-3 py-2" key={item.key}>
      <p className="text-xs text-task-text-muted">{item.label}</p>
      <p className="mt-1"><Tag tone={TONE[item.tone]}>{item.value}</Tag></p>
    </li>)}
  </ul>;
}

// ---------------------------------------------------------------------------
const STATUS_WORD: Readonly<Record<string, string>> = { completed: "Done", removed: "Task deleted", cancelled: "Cancelled", in_progress: "In progress", active: "In progress" };

/** Suggested next actions: review, then one Task (or one chosen FMS run) each; never sent to the customer. */
export function FollowUpsPanel({ sessionId, integration, retentionExpired, onChanged, navigate, onSeekEvidence }: {
  sessionId: string; integration: ConversationIntegration; retentionExpired: boolean; onChanged: () => void; navigate: (path: string) => void;
  onSeekEvidence: (suggestion: Suggestion) => ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const followUps = integration.follow_ups;
  return <div className="space-y-4">
    {notice ? <Notice tone="success">{notice}</Notice> : null}
    {retentionExpired ? <Notice tone="task">This conversation is past its retention period, so new follow-ups cannot be created from it.</Notice> : null}
    {integration.suggestions.length ? <ul className="space-y-3">{integration.suggestions.map((suggestion) => {
      const existing = suggestion.existing;
      const existingView = existing ? followUps.find((f) => (existing.task_id && f.task_id === existing.task_id) || (existing.fms_instance_id && f.fms_instance_id === existing.fms_instance_id)) : undefined;
      return <li key={`${suggestion.analysis_id}:${suggestion.action_index}`}><Panel>
        <p className="text-base font-semibold text-task-text">{suggestion.action}</p>
        {suggestion.reason ? <p className="mt-0.5 text-sm text-task-text-muted">{suggestion.reason}</p> : null}
        {onSeekEvidence(suggestion)}
        <div className="mt-3">
          {existing ? <Tag tone="success">Follow-up created{existingView ? ` · ${STATUS_WORD[existingView.status] ?? "Open"}` : ""}</Tag>
            : open === suggestion.action_index ? <FollowUpForm integration={integration} onCancel={() => setOpen(null)} onCreated={(text) => { setOpen(null); setNotice(text); onChanged(); }} sessionId={sessionId} suggestion={suggestion} />
            : <Button disabled={retentionExpired || !integration.can_create_follow_up} onClick={() => setOpen(suggestion.action_index)} type="button">Review follow-up</Button>}
        </div>
      </Panel></li>;
    })}</ul> : <Panel><p className="text-sm text-task-text-muted">No follow-ups were suggested for this conversation.</p></Panel>}

    <Panel description="Every follow-up made from this conversation, with its live status." title="Follow-ups">
      {followUps.length ? <ul className="divide-y divide-task-border">{followUps.map((f) => <FollowUpRow followUp={f} key={f.follow_up_id ?? f.task_id ?? f.created_at} navigate={navigate} sessionId={sessionId} />)}</ul>
        : <p className="text-sm text-task-text-muted">None yet.</p>}
    </Panel>
    <p className="text-xs text-task-text-muted">Each suggestion becomes at most one piece of work, even after a rescore. Editing the task never changes the conversation or its transcript. Nothing is sent to the customer from here.</p>
  </div>;
}

function FollowUpRow({ followUp: f, navigate, sessionId }: { followUp: FollowUpView; navigate: (path: string) => void; sessionId: string }) {
  const path = f.fms_instance_id ? fmsAssignedWorkPath({ kind: "stage", instanceId: f.fms_instance_id, instanceStageId: f.fms_stage_id }) : f.task_id ? `/tasks?task_id=${encodeURIComponent(f.task_id)}` : null;
  return <li className="space-y-1 py-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-semibold text-task-text">{f.title}</p>
      <Tag tone={f.status === "completed" ? "success" : f.status === "removed" ? "attention" : "progress"}>{STATUS_WORD[f.status] ?? "Open"}</Tag>
    </div>
    <p className="text-task-text-muted">
      {FOLLOW_UP_CHANNEL_LABEL[f.channel]} · {f.owner_name ?? "Owner"}{f.due_at ? ` · due ${istDateTime(f.due_at)}` : ""}{f.due_half ? ` (${DAY_HALF_LABELS[f.due_half]})` : ""}
      {f.fms_reference ? ` · ${f.fms_reference}` : ""}{f.supervisor_name ? ` · reminder to ${f.supervisor_name}` : ""}
    </p>
    <p className="text-xs text-task-text-muted">
      Source: conversation {sessionId.slice(0, 8)}{f.source_text && f.source_text !== f.title ? ` (“${f.source_text}”)` : ""} · created by {f.created_by_name ?? "a colleague"} on {istDateTime(f.created_at)}
      {f.customer ? ` · CRM: ${f.customer.name ?? ""}${f.customer.code ? ` ${f.customer.code}` : ""}${f.customer.state === "verified" ? "" : " (not yet confirmed)"}` : ""}
      {f.notification ? ` · notification ${f.notification.state === "delivered" ? "delivered" : f.notification.state === "failed" ? "failed" : "waiting"}` : ""}
    </p>
    {path ? <a className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-secondary hover:underline" href={path} onClick={(event) => { if (event.metaKey || event.ctrlKey || event.button !== 0) return; event.preventDefault(); navigate(path); }}>
      {f.fms_instance_id ? "Open FMS work" : "Open task"}</a> : null}
  </li>;
}

function FollowUpForm({ sessionId, integration, suggestion, onCancel, onCreated }: {
  sessionId: string; integration: ConversationIntegration; suggestion: Suggestion; onCancel: () => void; onCreated: (message: string) => void;
}) {
  const options = useLoad(() => fetchFollowUpOptions(sessionId), [sessionId]);
  const [title, setTitle] = useState(`Follow up: ${suggestion.action}`.slice(0, 200));
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<FollowUpChannel>("call");
  const [ownerId, setOwnerId] = useState("");
  const [supervisorId, setSupervisorId] = useState("");
  const [dueDate, setDueDate] = useState(indiaToday());
  const [dueHalf, setDueHalf] = useState<DayHalf>("second_half");
  const [flowId, setFlowId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestKey = useRef<string>(crypto.randomUUID());
  const owners = options.data?.owners ?? [];
  const supervisors = useMemo(() => (options.data?.supervisors ?? []).filter((s) => s.id !== ownerId), [options.data, ownerId]);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const result = await createFollowUp({ analysisId: suggestion.analysis_id, actionIndex: suggestion.action_index, requestKey: requestKey.current, title, note, channel,
        ownerId: ownerId || null, supervisorId: supervisorId || null, dueDate, dueHalf, fmsFlowId: flowId || null });
      onCreated(result.alreadyCreated ? "This suggestion already has a follow-up." : result.fmsReference ? `Workflow ${result.fmsReference} started. Its first step is in Tasks › FMS.` : "Follow-up task created. It is in Tasks for its owner.");
    } catch (cause) { setError(message(cause, "The follow-up could not be created.")); }
    finally { setBusy(false); }
  };
  const id = (name: string) => `si-fu-${suggestion.action_index}-${name}`;
  return <form className="space-y-3 rounded-xl border border-task-border p-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <p className="text-sm font-semibold text-task-text">Review before creating</p>
    {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
    <div className="space-y-1"><label className="block text-xs font-semibold text-task-text-muted" htmlFor={id("title")}>Task title</label>
      <input className="field w-full" id={id("title")} maxLength={200} onChange={(e) => setTitle(e.target.value)} required value={title} /></div>
    <div className="space-y-1"><label className="block text-xs font-semibold text-task-text-muted" htmlFor={id("channel")}>Recommended follow-up</label>
      <select className="field w-full" id={id("channel")} onChange={(e) => setChannel(e.target.value as FollowUpChannel)} value={channel}>
        {FOLLOW_UP_CHANNELS.map((value) => <option key={value} value={value}>{FOLLOW_UP_CHANNEL_LABEL[value]}</option>)}
      </select>
      <p className="text-xs text-task-text-muted">A recommendation for the owner. Nothing is sent to the customer from here.</p></div>
    <div className="space-y-1"><label className="block text-xs font-semibold text-task-text-muted" htmlFor={id("owner")}>Owner</label>
      <select className="field w-full" disabled={!owners.length} id={id("owner")} onChange={(e) => setOwnerId(e.target.value)} value={ownerId}>
        <option value="">The salesperson</option>
        {owners.filter((o) => !o.is_salesperson).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select></div>
    <fieldset className="space-y-1"><legend className="text-xs font-semibold text-task-text-muted">Due</legend>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Due day" className="field" min={indiaToday()} onChange={(e) => setDueDate(e.target.value)} required type="date" value={dueDate} />
        {(["first_half", "second_half"] as const).map((half) => <label className="inline-flex min-h-11 items-center gap-1.5 text-sm text-task-text" key={half}>
          <input checked={dueHalf === half} name={id("half")} onChange={() => setDueHalf(half)} type="radio" />{DAY_HALF_LABELS[half]} ({half === "first_half" ? "3 PM" : "9 PM"})</label>)}
      </div></fieldset>
    {supervisors.length ? <div className="space-y-1"><label className="block text-xs font-semibold text-task-text-muted" htmlFor={id("supervisor")}>Coaching reminder (optional)</label>
      <select className="field w-full" id={id("supervisor")} onChange={(e) => setSupervisorId(e.target.value)} value={supervisorId}>
        <option value="">None</option>{supervisors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select><p className="text-xs text-task-text-muted">Loops in a branch manager through the task's usual updates.</p></div> : null}
    {options.data?.flows.length ? <div className="space-y-1"><label className="block text-xs font-semibold text-task-text-muted" htmlFor={id("flow")}>Start an FMS workflow instead (optional)</label>
      <select className="field w-full" id={id("flow")} onChange={(e) => setFlowId(e.target.value)} value={flowId}>
        <option value="">No, create a task</option>{options.data.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select><p className="text-xs text-task-text-muted">Only workflows that are started by hand are listed. The workflow assigns and times its own steps.</p></div> : null}
    <div className="space-y-1"><label className="block text-xs font-semibold text-task-text-muted" htmlFor={id("note")}>Note (optional)</label>
      <textarea className="field min-h-16 w-full" id={id("note")} maxLength={1000} onChange={(e) => setNote(e.target.value)} value={note} /></div>
    {integration.customer ? <p className="text-xs text-task-text-muted">CRM customer: {integration.customer.name ?? ""}{integration.customer.code ? ` ${integration.customer.code}` : ""}{integration.customer.state === "verified" ? "" : " (not yet confirmed by the CRM)"}</p> : null}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !title.trim() || !dueDate} type="submit">{flowId ? "Start workflow" : "Create task"}</Button>
      <Button disabled={busy} onClick={onCancel} type="button" variant="ghost">Cancel</Button>
    </div>
  </form>;
}
