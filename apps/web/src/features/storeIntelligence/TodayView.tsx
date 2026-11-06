import { useState } from "react";
import { ArrowRight, Lightbulb, Mic } from "lucide-react";
import { conversationFiltersToQuery, conversationStatus, formatDuration, formatRecordedTotal, followUpChoices, istDateKey, istTime, type ConversationCard, type NextAction } from "@jewelos/core";
import { createActionTask, fetchToday } from "@jewelos/data";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { useRecorder } from "@/features/recording/useRecorder";
import { cn } from "@/lib/utils";
import { siPath } from "./routes";
import { EmptyState, ErrorState, Panel, ScoreBadge, SkeletonRows, StatusPill, useFlash } from "./ui";
import { useLoad } from "./useLoad";

export function ConversationRow({ card, showEmployee, onOpen }: { card: ConversationCard; showEmployee: boolean; onOpen: (id: string) => void }) {
  const status = conversationStatus(card);
  const outcome = card.analysis?.outcome && card.analysis.outcome !== "unknown" ? card.analysis.outcome : null;
  return <a className="group block rounded-xl px-3 py-3 transition-colors hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold" href={siPath.conversation(card.id)}
    onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); onOpen(card.id); }}>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold text-task-text">{showEmployee ? card.employee_name ?? "Salesperson" : istTime(card.created_at)}</span>
          <span className="text-task-text-muted">{showEmployee ? `${istTime(card.created_at)} · ` : ""}{card.duration_ms ? formatDuration(card.duration_ms) : "No audio yet"}</span>
          {card.customer_linked ? <span className="text-xs text-task-text-muted">· CRM walk-in</span> : null}
        </p>
        {card.analysis?.summary ? <p className="mt-1 line-clamp-2 text-sm text-task-text-muted">{card.analysis.summary}</p>
          : status.detail ? <p className="mt-1 line-clamp-2 text-sm text-task-text-muted">{status.detail}</p> : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusPill status={status} />
          {outcome ? <span className="text-xs text-task-text-muted">{outcomeWords(outcome)}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {card.analysis ? <ScoreBadge managerScored={card.analysis.manager_scored} score={card.analysis.score} /> : null}
        <ArrowRight aria-hidden className="size-4 text-task-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  </a>;
}
const outcomeWords = (outcome: string) => ({ reported_purchase: "Purchase mentioned", follow_up: "Follow-up agreed", enquiry: "Enquiry", no_purchase: "No purchase" } as Record<string, string>)[outcome] ?? "";

export function NextActionItem({ item, onOpen, onDone }: { item: NextAction; onOpen: () => void; onDone: (message: string) => void }) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async (at: string) => {
    setBusy(true); setError(null);
    try { const result = await createActionTask(item.analysis_id, item.action_index, at); onDone(result.alreadyCreated ? "That task already exists. Find it in Tasks." : "Follow-up task created. Find it in Tasks."); setChoosing(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The task could not be created."); }
    finally { setBusy(false); }
  };
  return <li className="rounded-xl border border-task-border p-3">
    <p className="text-sm font-semibold text-task-text">{item.action}</p>
    {item.reason ? <p className="mt-0.5 text-sm text-task-text-muted">{item.reason}</p> : null}
    {error ? <p className="mt-2 text-sm text-danger" role="alert">{error}</p> : null}
    {choosing ? <fieldset className="mt-3"><legend className="mb-2 text-xs font-semibold text-task-text-muted">When should it be done?</legend>
      <div className="flex flex-wrap gap-2">{followUpChoices().map((choice) => <Button disabled={busy} key={choice.key} onClick={() => void create(choice.at)} type="button" variant="secondary">{choice.label}</Button>)}
        <Button disabled={busy} onClick={() => setChoosing(false)} type="button" variant="ghost">Cancel</Button></div></fieldset>
      : <div className="mt-2 flex flex-wrap gap-2">
        <Button onClick={() => setChoosing(true)} type="button">Create follow-up task</Button>
        <Button onClick={onOpen} type="button" variant="ghost">Open conversation</Button>
      </div>}
  </li>;
}

export function TodayView({ navigate, canRecordUi }: { navigate: (path: string) => void; canRecordUi: boolean }) {
  const { profile } = useAuth();
  const rec = useRecorder(profile?.id);
  const today = useLoad(fetchToday, [], 15000);
  const [flash, setFlash] = useFlash();
  const day = istDateKey(new Date());
  const stageLink = (stage: string) => siPath.conversations(conversationFiltersToQuery({ stage: stage as "ready", date_from: day, date_to: day, ...(today.data?.is_reviewer && profile ? { employee_id: profile.id } : {}) }));
  const live = ["recording", "paused", "saving", "needs_attention"].includes(rec.state);
  if (today.error && !today.data) return <ErrorState message={today.error} onRetry={today.reload} />;
  const data = today.data;
  return <div className="space-y-5">
    <header>
      <p className="text-sm text-task-text-muted">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}</p>
      <h1 className="text-2xl font-semibold text-task-text">Today</h1>
    </header>
    {flash ? <Notice tone="success">{flash}</Notice> : null}

    {live ? <Panel className="border-danger/30">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={cn("flex items-center gap-2 text-base font-semibold", rec.state === "recording" ? "text-danger" : "text-task-text")} role="status">
          {rec.state === "recording" ? <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger motion-reduce:animate-none" /> : null}
          {rec.state === "recording" ? "Recording now" : rec.state === "paused" ? "Recording paused" : rec.state === "saving" ? "Saving your recording" : "Recording needs attention"}
        </p>
        <Button className="min-h-12" onClick={() => navigate(siPath.record())} type="button">Open recorder</Button>
      </div>
    </Panel> : canRecordUi ? <div>
      <Button className="min-h-16 w-full text-lg sm:w-auto sm:px-10" disabled={data ? !data.can_record : false} onClick={() => navigate(siPath.record())} type="button"><Mic aria-hidden className="size-6" />Start conversation</Button>
      {data && !data.can_record ? <p className="mt-2 text-sm text-task-text-muted">{!data.has_capture_permission ? "Recording needs permission from your administrator." : !data.pilot_enabled ? "Recording is switched off for the business right now." : "Your account or branch is not on the recording list yet."}</p> : null}
    </div> : null}

    {!data ? <SkeletonRows label="Loading today" rows={3} /> : <>
      <section aria-label="Today in numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QueueTile count={data.today.total} label="Recorded today" />
        <QueueTile count={data.today.processing + data.today.saving} href={stageLink("processing")} label="Processing" navigate={navigate} />
        <QueueTile count={data.today.ready} href={stageLink("ready")} label="Ready" navigate={navigate} />
        <QueueTile attention count={data.today.needs_attention} href={stageLink("needs_attention")} label="Needs attention" navigate={navigate} />
      </section>
      {data.today.recorded_ms ? <p className="-mt-2 text-sm text-task-text-muted">{formatRecordedTotal(data.today.recorded_ms)} recorded today.</p> : null}

      {data.is_reviewer && data.review_queue ? <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-base font-semibold text-task-text">{data.review_queue} {data.review_queue === 1 ? "conversation is" : "conversations are"} waiting for your review</p>
            <p className="text-sm text-task-text-muted">Staff see their summary and coaching only after you approve it.</p></div>
          <Button onClick={() => navigate(siPath.coaching())} type="button">Review now</Button>
        </div>
      </Panel> : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Next actions" description="Follow-ups suggested from your reviewed conversations.">
          {data.next_actions.length ? <ul className="space-y-2">{data.next_actions.map((item) => <NextActionItem item={item} key={`${item.analysis_id}-${item.action_index}`} onDone={(message) => { setFlash(message); today.reload(); }} onOpen={() => navigate(siPath.conversation(item.session_id, "actions"))} />)}</ul>
            : <p className="text-sm text-task-text-muted">Nothing to follow up right now.</p>}
        </Panel>
        <Panel title="My coaching" description="From the last 30 days of reviewed conversations.">
          {data.coaching.reviewed ? <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-3"><span className="text-sm text-task-text-muted">Average score · {data.coaching.reviewed} reviewed</span><ScoreBadge score={data.coaching.average_score} /></div>
            {data.coaching.strength ? <p className="text-sm text-task-text"><span className="font-semibold">Doing well:</span> {data.coaching.strength.label} ({data.coaching.strength.average}/10)</p> : null}
            {data.coaching.focus ? <p className="text-sm text-task-text"><span className="font-semibold">Work on:</span> {data.coaching.focus.label} ({data.coaching.focus.average}/10)</p> : null}
            {data.coaching.tip ? <div className="flex gap-2 rounded-xl bg-gold/10 p-3"><Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-secondary" /><p className="text-sm text-task-text"><span className="font-semibold">Try this:</span> {data.coaching.tip.text}</p></div> : null}
          </div> : <p className="text-sm text-task-text-muted">Your coaching appears here after your manager reviews a conversation.</p>}
        </Panel>
      </div>

      <Panel action={<Button onClick={() => navigate(siPath.conversations())} type="button" variant="ghost">See all</Button>} title="Recent conversations">
        {data.recent.length ? <ul className="-mx-3 divide-y divide-task-border">{data.recent.map((card) => <li key={card.id}><ConversationRow card={card} onOpen={(id) => navigate(siPath.conversation(id))} showEmployee={false} /></li>)}</ul>
          : <EmptyState title="No conversations yet">{canRecordUi ? "Tap Start conversation when a customer is ready." : "Conversations you record will appear here."}</EmptyState>}
      </Panel>
    </>}
  </div>;
}

function QueueTile({ label, count, href, navigate, attention = false }: { label: string; count: number; href?: string; navigate?: (path: string) => void; attention?: boolean }) {
  const body = <>
    <span className="text-xs font-medium text-task-text-muted">{label}</span>
    <span className={cn("mt-1 block text-2xl font-semibold tabular-nums text-task-text", attention && count > 0 && "text-danger")}>{count}</span>
  </>;
  const className = cn("block min-h-[4.75rem] rounded-xl border border-task-border bg-task-bg p-3 shadow-card", attention && count > 0 && "border-warning/50");
  if (!href || !navigate || !count) return <div className={className}>{body}</div>;
  return <a className={cn(className, "transition-colors hover:border-gold/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold")} href={href}
    onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); navigate(href); }}>{body}<span className="sr-only">, open list</span></a>;
}
