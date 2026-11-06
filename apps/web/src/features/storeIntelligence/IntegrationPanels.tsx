import { useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink, RefreshCw, Search } from "lucide-react";
import {
  AI_INTENT_LABEL, candidateQueryKind, CRM_REFUSAL_REASON, CRM_RESULT_LABEL, crmProfilePathFor, DAY_HALF_LABELS, FOLLOW_UP_CHANNEL_LABEL, FOLLOW_UP_CHANNELS,
  fmsAssignedWorkPath, LINK_STATE_LABEL, linkTargetFor, readinessItems, SYNC_LABEL,
  type ConversationIntegration, type CrmCandidate, type CrmCandidateResult, type DayHalf, type FollowUpChannel, type FollowUpView, type ReadinessTone, type Suggestion,
} from "@jewelos/core";
import { createFollowUp, fetchFollowUpOptions, linkCrmCustomer, retryCrmSync, unlinkCrmCustomer, WorkspaceError } from "@jewelos/data";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CandidateSearchFailure, searchCrmCandidates } from "./crmCandidateSearch";
import { Panel, Tag } from "./ui";
import { useLoad } from "./useLoad";

const message = (cause: unknown, fallback: string) => (cause instanceof WorkspaceError || cause instanceof CandidateSearchFailure) && cause.message ? cause.message : fallback;
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
/** The CRM customer for this conversation: exact search, human choice, audited changes. */
export function CustomerLinkSection({ sessionId, integration, retentionExpired, onChanged, navigate }: {
  sessionId: string; integration: ConversationIntegration; retentionExpired: boolean; onChanged: () => void; navigate: (path: string) => void;
}) {
  const link = integration.customer;
  const [mode, setMode] = useState<"view" | "search" | "unlink">("view");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<CrmCandidateResult | null>(null);
  const [chosen, setChosen] = useState<CrmCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const requestKey = useRef<string>(crypto.randomUUID());
  const profilePath = crmProfilePathFor(link);
  const kind = candidateQueryKind(query);

  const search = async () => {
    setBusy(true); setError(null); setResult(null); setChosen(null);
    try { const found = await searchCrmCandidates(query.trim()); setResult(found); if (found.candidates.length === 1) setChosen(found.candidates[0]!); }
    catch (cause) { setError(message(cause, "The CRM could not be searched.")); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!result || !chosen) return;
    setBusy(true); setError(null);
    try {
      // The same request key is reused if this tap is retried after a network failure.
      const saved = await linkCrmCustomer(sessionId, linkTargetFor(result, chosen), requestKey.current, link ? reason : undefined);
      requestKey.current = crypto.randomUUID();
      setNotice(saved.alreadyLinked ? "This customer is already linked." : "Linked. It shows as confirmed once the CRM accepts it.");
      setMode("view"); setResult(null); setChosen(null); setQuery(""); setReason(""); onChanged();
    } catch (cause) { setError(message(cause, "The customer could not be linked.")); }
    finally { setBusy(false); }
  };
  const unlink = async () => {
    setBusy(true); setError(null);
    try { await unlinkCrmCustomer(sessionId, reason); setNotice("Link removed. The CRM entry is withdrawn when the CRM is reached."); setMode("view"); setReason(""); onChanged(); }
    catch (cause) { setError(message(cause, "The link could not be removed.")); }
    finally { setBusy(false); }
  };
  const retry = async () => {
    setBusy(true); setError(null);
    try { await retryCrmSync(sessionId); setNotice("Sending to the CRM again."); onChanged(); }
    catch (cause) { setError(message(cause, "Could not send again.")); }
    finally { setBusy(false); }
  };

  return <section aria-labelledby="si-crm-customer" className="space-y-3">
    <h3 className="font-semibold text-task-text" id="si-crm-customer">CRM customer</h3>
    {notice ? <Notice tone="success">{notice}</Notice> : null}
    {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
    {link ? <div className="space-y-2 rounded-xl border border-task-border p-3">
      <p className="text-base font-semibold text-task-text">{link.name ?? "Name not recorded"}{link.code ? <span className="ml-1.5 text-sm font-normal text-task-text-muted">{link.code}</span> : null}</p>
      {link.display_source !== "crm_ack" ? <p className="text-xs text-task-text-muted">Name and code as shown in the search; the CRM has not confirmed them yet.</p>
        : link.display_stale ? <p className="text-xs text-task-text-muted">Saved from the CRM on {istDate(link.verified_at ?? link.linked_at)}; open the CRM profile for current details.</p> : null}
      <div className="flex flex-wrap gap-2">
        <Tag tone={link.state === "verified" ? "success" : link.state === "rejected" ? "attention" : "progress"}>{LINK_STATE_LABEL[link.state]}</Tag>
        <Tag tone={link.sync === "synced" ? "success" : ["failed", "refused"].includes(link.sync) ? "attention" : "progress"}>{SYNC_LABEL[link.sync]}</Tag>
      </div>
      {link.state === "rejected" && link.state_reason ? <p className="text-sm text-task-text">{CRM_REFUSAL_REASON[link.state_reason] ?? "The CRM refused it."}</p> : null}
      <p className="text-xs text-task-text-muted">Linked by {link.linked_by_name ?? "a colleague"} on {istDateTime(link.linked_at)}{link.candidate_count > 1 ? `, chosen from ${link.candidate_count} people with the same ${link.match_basis === "phone" ? "phone number" : "details"}` : ""}.</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {profilePath ? <Button onClick={() => navigate(profilePath)} type="button" variant="secondary"><ExternalLink aria-hidden className="size-4" />Open CRM profile</Button> : null}
        {integration.can_link && ["failed", "waiting_for_crm_approval", "retrying"].includes(link.sync) ? <Button disabled={busy} onClick={() => void retry()} type="button" variant="secondary"><RefreshCw aria-hidden className="size-4" />Send again</Button> : null}
        {integration.can_link && !retentionExpired && mode === "view" ? <>
          <Button disabled={busy} onClick={() => { setMode("search"); setError(null); }} type="button" variant="ghost">Change customer</Button>
          <Button disabled={busy} onClick={() => { setMode("unlink"); setError(null); }} type="button" variant="ghost">Remove link</Button>
        </> : null}
      </div>
    </div> : <p className="text-sm text-task-text-muted">No CRM customer linked. Results stay “Pending CRM confirmation” until one is.</p>}

    {integration.can_link && !link && mode === "view" && !retentionExpired ? <Button onClick={() => setMode("search")} type="button">Link customer</Button> : null}
    {!integration.can_link && !link ? <p className="text-xs text-task-text-muted">Linking needs CRM access, and is done by the salesperson or a branch manager.</p> : null}

    {mode === "unlink" ? <div className="space-y-2 rounded-xl border border-task-border p-3">
      <label className="block text-sm font-semibold text-task-text" htmlFor="si-unlink-reason">Why remove this link? (needed)</label>
      <textarea className="field min-h-20" id="si-unlink-reason" maxLength={500} onChange={(e) => setReason(e.target.value)} value={reason} />
      <div className="flex flex-wrap gap-2"><Button disabled={busy || reason.trim().length < 3} onClick={() => void unlink()} type="button">Remove link</Button>
        <Button disabled={busy} onClick={() => { setMode("view"); setReason(""); }} type="button" variant="ghost">Cancel</Button></div>
    </div> : null}

    {mode === "search" ? <div className="space-y-3 rounded-xl border border-task-border p-3">
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); if (kind !== "invalid") void search(); }} role="search">
        <label className="block text-sm font-semibold text-task-text" htmlFor="si-crm-query">Client code, visit reference or full phone number</label>
        <div className="flex gap-2">
          <input autoComplete="off" className="field flex-1" id="si-crm-query" inputMode="text" maxLength={40} onChange={(e) => { setQuery(e.target.value); setResult(null); setChosen(null); }} placeholder="MKC-200001 or 98765 43210" value={query} />
          <Button disabled={busy || kind === "invalid"} type="submit"><Search aria-hidden className="size-4" />Search</Button>
        </div>
        <p className="text-xs text-task-text-muted">Names are not searched, so a customer is never guessed. Nothing new is created in the CRM from here.</p>
      </form>
      {result ? result.candidates.length === 0 ? <p className="text-sm text-task-text">No CRM customer has this {result.query_kind === "phone" ? "phone number" : "code"}. Register the customer in CRM first, then link.</p>
        : <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-task-text">{result.candidates.length > 1 ? `${result.candidates.length} people share this ${result.query_kind === "phone" ? "number" : "reference"}. Choose the right person; they are never merged.` : "Is this the customer?"}</legend>
          {result.candidates.map((candidate) => <label className={cn("flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border p-3", chosen === candidate ? "border-gold bg-gold/5" : "border-task-border")} key={`${candidate.kind}:${candidate.target_id}`}>
            <input checked={chosen === candidate} className="mt-1" name="si-crm-candidate" onChange={() => setChosen(candidate)} type="radio" />
            <span className="min-w-0 text-sm">
              <span className="block font-semibold text-task-text">{candidate.name}{candidate.client_code ? ` · ${candidate.client_code}` : ""}{candidate.kind === "lead" ? " · Lead" : ""}</span>
              <span className="block text-task-text-muted">{[candidate.phone_hint, candidate.visit_at ? `Visit ${istDate(candidate.visit_at)}` : candidate.last_visit_at ? `Last visit ${istDate(candidate.last_visit_at)}` : "No visits yet", `${candidate.total_visits} visit${candidate.total_visits === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
            </span>
          </label>)}
        </fieldset> : null}
      {link && result?.candidates.length ? <div className="space-y-1">
        <label className="block text-sm font-semibold text-task-text" htmlFor="si-change-reason">Why change the customer? (needed)</label>
        <textarea className="field min-h-20" id="si-change-reason" maxLength={500} onChange={(e) => setReason(e.target.value)} value={reason} />
      </div> : null}
      <div className="flex flex-wrap gap-2">
        {result?.candidates.length ? <Button disabled={busy || !chosen || (Boolean(link) && reason.trim().length < 3)} onClick={() => void save()} type="button">{link ? "Change customer" : "Link this customer"}</Button> : null}
        <Button disabled={busy} onClick={() => { setMode("view"); setResult(null); setChosen(null); setQuery(""); setReason(""); }} type="button" variant="ghost">Cancel</Button>
      </div>
    </div> : null}

    {integration.history.length ? <details className="text-sm"><summary className="cursor-pointer font-semibold text-task-text-muted">Earlier links ({integration.history.length})</summary>
      <ul className="mt-2 space-y-1.5">{integration.history.map((h) => <li className="text-task-text" key={h.link_id}>
        {h.name ?? "Name not recorded"}{h.code ? ` (${h.code})` : ""} · {h.end_kind === "corrected" ? "corrected" : "removed"} by {h.ended_by_name ?? "a colleague"}{h.ended_at ? ` on ${istDateTime(h.ended_at)}` : ""}{h.end_reason ? `: “${h.end_reason}”` : ""}
        {h.withdrawal_sync ? <span className="text-task-text-muted"> · CRM entry {h.withdrawal_sync === "synced" ? "withdrawn" : h.withdrawal_sync === "failed" ? "withdrawal failed" : "being withdrawn"}</span> : null}
      </li>)}</ul>
    </details> : null}
  </section>;
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
