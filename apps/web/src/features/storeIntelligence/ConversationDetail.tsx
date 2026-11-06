import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Link2, Lightbulb, UserRound } from "lucide-react";
import {
  compareSalesAnalyses, conversationStatus, evidenceSeekTargets, followUpChoices, formatAudioOffset, formatDuration, hasAnalysisOutput, hasPermission, istTime,
  OUTCOME_LABEL, QUALITY_REASON, SALES_SIGNAL_KEYS, taskStatusLabel,
  type ActionTaskLink, type AnalysisSnapshot, type AnalysisTranscriptSegment, type ConversationCard, type EvidenceRef, type SalesDimensionStatus,
  type SpeakerRole, type StoredSalesAnalysis,
} from "@jewelos/core";
import {
  AnalysisActionError, correctTranscript, createActionTask, fetchActionTasks, fetchAnalysisSnapshot, fetchConversationCard, linkRecordingWalkin, recordingSnapshot,
  recordingWalkins, requestReprocess, requestRescore, reviewAnalysis, type DimensionOverride,
} from "@jewelos/data";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { AudioPlayer, type AudioPlayerHandle } from "./AudioPlayer";
import { siPath, type DetailTab } from "./routes";
import { Disclosure, Drawer, ErrorState, Meter, Panel, ScoreBadge, SkeletonRows, StatusPill, TabBar, Tag, useFlash } from "./ui";
import { useLoad } from "./useLoad";

const SPEAKER: Readonly<Record<SpeakerRole, string>> = { employee: "Salesperson", customer: "Customer", unknown: "Unknown speaker" };
const SIGNAL: Readonly<Record<string, string>> = {
  objection: "Objection raised", price_concern: "Price concern", stock_gap: "Item not in stock", competitor_mention: "Another store mentioned",
  customer_questions: "Customer asked questions", conversion_signal: "Buying signal", next_step: "Next step agreed", drop_off: "Customer lost interest", upsell_opportunity: "Chance to suggest more",
};
const DIM_STATUS: Readonly<Record<SalesDimensionStatus, string>> = { assessed: "Scored", not_applicable: "Not applicable", insufficient_evidence: "Not enough evidence" };
const REVIEW: Readonly<Record<string, string>> = { approve: "Approved", flag: "Flagged", unflag: "Flag removed", edit: "Scores edited", comment: "Comment" };
type TextView = "readable" | "original" | "english";
const segmentText = (segment: AnalysisTranscriptSegment, view: TextView) =>
  view === "readable" ? segment.display_text ?? segment.raw_text : view === "english" ? segment.translation_en ?? segment.display_text ?? segment.raw_text : segment.raw_text;

/** Evidence quotes: tapping one jumps to (and, for managers, plays) that moment. */
function Evidence({ refs, segments, onSeek }: { refs: readonly EvidenceRef[]; segments: readonly AnalysisTranscriptSegment[]; onSeek: (segmentId: string) => void }) {
  const targets = evidenceSeekTargets(refs, segments);
  if (!targets.length) return null;
  return <span className="mt-1.5 flex flex-wrap gap-1.5">{targets.map((target, index) =>
    <button className="min-h-11 max-w-full truncate rounded-lg border border-task-border bg-task-muted/60 px-2.5 text-left text-xs text-task-text-muted hover:border-gold/60 hover:text-task-text"
      key={`${target.segment_id}-${index}`} onClick={() => onSeek(target.segment_id)} title={target.quote} type="button">
      {formatAudioOffset(target.start_ms)} · “{target.quote}”
    </button>)}</span>;
}
function Block({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-1.5"><h3 className="text-sm font-semibold text-task-text">{title}</h3>{children}</div>;
}

export function ConversationDetail({ sessionId, tab, navigate }: { sessionId: string; tab: DetailTab; navigate: (path: string) => void }) {
  const { access } = useAuth();
  const card = useLoad(() => fetchConversationCard(sessionId), [sessionId], 10_000);
  const [revisionId, setRevisionId] = useState<string | undefined>(undefined);
  const snap = useLoad(() => fetchAnalysisSnapshot(sessionId, revisionId), [sessionId, revisionId], 15_000);
  const tasks = useLoad(() => fetchActionTasks(sessionId), [sessionId]);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const player = useRef<AudioPlayerHandle>(null);
  useEffect(() => { setRevisionId(undefined); setAnalysisId(null); setActive(null); }, [sessionId]);

  const c = card.data; const snapshot = snap.data;
  const analyses = snapshot?.analyses ?? [];
  const analysis = analyses.find((item) => item.id === analysisId) ?? analyses.at(-1) ?? null;
  const segments = snapshot?.segments ?? [];
  const reviewer = snapshot?.is_reviewer ?? c?.is_reviewer ?? false;
  const playable = Boolean(c && reviewer && !c.retention_expired && c.duration_ms > 0 && ["ready", "needs_attention"].includes(c.status));
  const canCoachAlerts = reviewer && hasPermission(access, "recording.coach");
  const alerts = useLoad(async () => (canCoachAlerts ? (await recordingSnapshot(sessionId)).alerts : []), [sessionId, canCoachAlerts]);

  const seek = (segmentId: string) => {
    // Evidence belongs to the transcript version its analysis used.
    if (analysis && snapshot && snapshot.revision_id !== analysis.transcript_revision_id) setRevisionId(analysis.transcript_revision_id);
    setActive(segmentId);
    const segment = segments.find((item) => item.segment_id === segmentId);
    if (segment && playable) player.current?.playFrom(Math.max(0, segment.start_ms - 1500));
    else if (tab !== "transcript") navigate(siPath.conversation(sessionId, "transcript"));
    requestAnimationFrame(() => document.getElementById(`seg-${segmentId}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" }));
  };
  const onPosition = (ms: number) => {
    const current = segments.find((segment) => ms >= segment.start_ms && ms < segment.end_ms + 300);
    if (current && current.segment_id !== active) setActive(current.segment_id);
  };

  if (card.error && !c) return <div className="space-y-4"><BackLink navigate={navigate} /><ErrorState message={card.error} onRetry={card.reload} /></div>;
  if (!c) return <div className="space-y-4"><BackLink navigate={navigate} /><SkeletonRows label="Loading conversation" rows={3} /></div>;
  const status = conversationStatus(c);
  const tabs: { id: DetailTab; label: string; href: string; badge?: number | null }[] = [
    { id: "summary", label: "Summary", href: siPath.conversation(sessionId, "summary") },
    { id: "transcript", label: "Transcript", href: siPath.conversation(sessionId, "transcript") },
    { id: "coaching", label: "Coaching", href: siPath.conversation(sessionId, "coaching") },
    { id: "actions", label: "Actions", href: siPath.conversation(sessionId, "actions"), badge: analysis && hasAnalysisOutput(analysis) ? analysis.output.next_best_actions.length || null : null },
  ];
  const outcome = analysis && hasAnalysisOutput(analysis) ? analysis.output.signals.sales_outcome.value : c.analysis?.outcome ?? null;
  const score = c.analysis?.score ?? null;

  return <div className="space-y-4">
    <BackLink navigate={navigate} />
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold text-task-text">{c.is_own ? "Your conversation" : `${c.employee_name ?? "Salesperson"}'s conversation`}</h1>
          <p className="text-sm text-task-text-muted">{new Date(c.created_at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}, {istTime(c.created_at)} · {c.duration_ms ? formatDuration(c.duration_ms) : "no audio"}{c.branch_name ? ` · ${c.branch_name}` : ""}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <StatusPill status={status} />
            {outcome && outcome !== "unknown" ? <Tag>{OUTCOME_LABEL[outcome]}<span className="text-task-text-muted"> · from the conversation</span></Tag> : null}
            {c.customer_linked ? <Tag tone="success"><Link2 aria-hidden className="size-3" />CRM walk-in</Tag> : null}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {c.analysis ? <ScoreBadge managerScored={c.analysis.manager_scored} score={score} size="lg" /> : null}
          <Button className="min-h-11" onClick={() => setDrawer(true)} type="button" variant="secondary"><UserRound aria-hidden className="size-4" />Customer details</Button>
        </div>
      </div>
    </Panel>

    {status.detail && c.stage !== "ready" ? <Notice tone={status.tone === "attention" ? "danger" : "task"}>{status.detail}</Notice> : null}
    {c.stage === "ready" && c.awaiting_review ? <Notice tone="task">Your manager reviews the summary and coaching before you see them.</Notice> : null}
    {c.retention_expired ? <Notice tone="task">Audio and transcript were removed after the retention period. The score and summary remain.</Notice> : null}
    {reviewer && !c.retention_expired && c.duration_ms === 0 && c.stage === "ready" ? <Notice tone="task">No audio was saved for this conversation.</Notice> : null}
    {c.error_reason === "capture_interrupted" && c.duration_ms > 0 ? <Notice tone="task">Only part of this conversation was saved ({formatDuration(c.duration_ms)}).</Notice> : null}
    {alerts.data?.length ? <Notice tone="danger"><p className="font-semibold">Coaching alert</p><ul className="mt-1 list-disc pl-5">{alerts.data.map((alert) => <li key={alert.id}>{alert.message}</li>)}</ul></Notice> : null}

    {playable ? <div className="sticky top-[calc(3.75rem+env(safe-area-inset-top))] z-20 md:top-[4.5rem]">
      <AudioPlayer durationMs={c.duration_ms} onPosition={onPosition} ref={player} segments={segments} sessionId={sessionId} />
    </div> : reviewer || c.retention_expired ? null : <p className="text-xs text-task-text-muted">Listening to recordings is limited to managers, and every listen is recorded.</p>}

    <TabBar controls="si-detail-panel" current={tab} items={tabs} label="Conversation sections" mode="tabs" onSelect={(id) => navigate(siPath.conversation(sessionId, id))} />
    <div aria-labelledby={`tab-${tab}`} id="si-detail-panel" role="tabpanel" tabIndex={0}>
      {snap.error && !snapshot ? <ErrorState message="The summary and transcript could not be loaded." onRetry={snap.reload} />
        : !snapshot ? <SkeletonRows label="Loading details" rows={3} />
        : tab === "summary" ? <SummaryTab analysis={analysis} card={c} onSeek={seek} reviewer={reviewer} segments={segments} snapshot={snapshot} />
        : tab === "transcript" ? <TranscriptTab active={active} onRefresh={snap.reload} onRevision={setRevisionId} onSeek={seek} playable={playable} reviewer={reviewer} sessionId={sessionId} snapshot={snapshot} />
        : tab === "coaching" ? <CoachingTab analyses={analyses} analysis={analysis} card={c} onAnalysis={setAnalysisId} onChanged={() => { snap.reload(); card.reload(); }} onSeek={seek} reviewer={reviewer} segments={segments} sessionId={sessionId} snapshot={snapshot} />
        : <ActionsTab analysis={analysis} card={c} links={tasks.data ?? []} onChanged={() => { tasks.reload(); snap.reload(); card.reload(); }} onSeek={seek} reviewer={reviewer} segments={segments} />}
    </div>

    {drawer ? <CustomerDrawer analysis={analysis} card={c} onClose={() => setDrawer(false)} onLinked={card.reload} onSeek={(id) => { setDrawer(false); seek(id); }} segments={segments} /> : null}
  </div>;
}

function BackLink({ navigate }: { navigate: (path: string) => void }) {
  return <a className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-task-text-muted hover:text-task-text" href={siPath.conversations()}
    onClick={(event) => { if (event.metaKey || event.ctrlKey || event.button !== 0) return; event.preventDefault(); if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) window.history.back(); else navigate(siPath.conversations()); }}>
    <ArrowLeft aria-hidden className="size-4" />Conversations</a>;
}

function NoReview({ card, reviewer, snapshot }: { card: ConversationCard; reviewer: boolean; snapshot: AnalysisSnapshot }) {
  const pending = snapshot.jobs.some((job) => job.state === "pending" || job.state === "leased");
  const text = !snapshot.revisions.length ? (card.stage === "ready" ? "No speech was found to summarise." : "The summary appears after the audio is turned into text.")
    : pending ? "The summary and coaching are being prepared. This page updates on its own."
    : reviewer ? "No summary yet." : "Your manager reviews the summary and coaching before you see them.";
  return <Panel><p className="text-sm text-task-text-muted">{text}</p></Panel>;
}

function SummaryTab({ analysis, card, snapshot, segments, onSeek, reviewer }: { analysis: StoredSalesAnalysis | null; card: ConversationCard; snapshot: AnalysisSnapshot; segments: readonly AnalysisTranscriptSegment[]; onSeek: (id: string) => void; reviewer: boolean }) {
  if (!analysis || !hasAnalysisOutput(analysis)) return analysis ? <Panel><p className="text-sm text-task-text">No summary: {analysis.status_reasons.map((reason) => QUALITY_REASON[reason] ?? reason).join(", ").toLowerCase() || "not enough to go on"}.</p></Panel> : <NoReview card={card} reviewer={reviewer} snapshot={snapshot} />;
  const o = analysis.output;
  const signals = SALES_SIGNAL_KEYS.filter((key) => o.signals[key].detected);
  const concerns = [...o.customer_concerns, ...o.purchase_blockers];
  return <div className="space-y-4">
    {analysis.status_reasons.length ? <Notice tone="task">Read with care: {analysis.status_reasons.map((reason) => QUALITY_REASON[reason] ?? reason).join(" · ")}.</Notice> : null}
    <Panel title="What happened">
      <p className="text-base leading-relaxed text-task-text">{o.summary}</p>
      <p className="mt-3 text-sm text-task-text-muted">Outcome from the conversation: <span className="font-semibold text-task-text">{OUTCOME_LABEL[o.signals.sales_outcome.value]}</span>. This is what was said, not a confirmed CRM sale.</p>
      <Evidence onSeek={onSeek} refs={o.signals.sales_outcome.evidence} segments={segments} />
    </Panel>
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="What the customer wants">
        <ul className="space-y-2 text-sm text-task-text">
          {o.customer_requirements.occasion ? <li><span className="font-semibold">Occasion:</span> {o.customer_requirements.occasion.text}<Evidence onSeek={onSeek} refs={o.customer_requirements.occasion.evidence} segments={segments} /></li> : null}
          {o.customer_requirements.budget ? <li><span className="font-semibold">Budget (as said):</span> {o.customer_requirements.budget.text}<Evidence onSeek={onSeek} refs={o.customer_requirements.budget.evidence} segments={segments} /></li> : null}
          {[...o.product_interests, ...o.customer_requirements.requirements].map((claim, index) => <li key={index}>{claim.text}<Evidence onSeek={onSeek} refs={claim.evidence} segments={segments} /></li>)}
          {!o.customer_requirements.occasion && !o.customer_requirements.budget && !o.product_interests.length && !o.customer_requirements.requirements.length ? <li className="text-task-text-muted">Nothing stated clearly.</li> : null}
        </ul>
      </Panel>
      <Panel title="Concerns and objections">
        <ul className="space-y-2 text-sm text-task-text">
          {concerns.map((claim, index) => <li key={index}>{claim.text}<Evidence onSeek={onSeek} refs={claim.evidence} segments={segments} /></li>)}
          {o.competitor_mentions.map((claim, index) => <li key={`c${index}`}><span className="font-semibold">Other store:</span> {claim.text}<Evidence onSeek={onSeek} refs={claim.evidence} segments={segments} /></li>)}
          {!concerns.length && !o.competitor_mentions.length ? <li className="text-task-text-muted">None raised.</li> : null}
        </ul>
      </Panel>
    </div>
    {o.key_points.length ? <Panel title="Key moments"><ul className="space-y-2 text-sm text-task-text">{o.key_points.map((claim, index) => <li key={index}>{claim.text}<Evidence onSeek={onSeek} refs={claim.evidence} segments={segments} /></li>)}</ul></Panel> : null}
    {signals.length ? <Panel title="Signals"><ul className="flex flex-wrap gap-2">{signals.map((key) => <li key={key}><Tag>{SIGNAL[key]}</Tag></li>)}</ul></Panel> : null}
  </div>;
}

function TranscriptTab({ snapshot, active, onSeek, reviewer, playable, sessionId, onRevision, onRefresh }: {
  snapshot: AnalysisSnapshot; active: string | null; onSeek: (id: string) => void; reviewer: boolean; playable: boolean; sessionId: string; onRevision: (id: string | undefined) => void; onRefresh: () => void;
}) {
  const [view, setView] = useState<TextView>("readable");
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { speaker: SpeakerRole; raw_text: string }>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useFlash();
  const [error, setError] = useState<string | null>(null);
  const segments = snapshot.segments;
  const latest = snapshot.revisions.at(-1);
  const matches = useMemo(() => { const q = query.trim().toLowerCase(); return q ? segments.filter((segment) => segmentText(segment, view).toLowerCase().includes(q)).map((segment) => segment.segment_id) : []; }, [query, segments, view]);
  useEffect(() => { setHit(0); }, [query]);
  useEffect(() => { const id = matches[hit]; if (id) document.getElementById(`seg-${id}`)?.scrollIntoView?.({ block: "center", behavior: "smooth" }); }, [hit, matches]);
  if (!snapshot.revisions.length) return <Panel><p className="text-sm text-task-text-muted">The transcript appears after the audio is turned into text.</p></Panel>;
  const act = async (action: () => Promise<string>) => {
    if (busy) return; setBusy(true); setError(null);
    try { setMessage(await action()); onRefresh(); } catch (cause) { setError(cause instanceof AnalysisActionError ? cause.message : "That could not be saved."); } finally { setBusy(false); }
  };
  const needNote = () => { if (note.trim().length < 3) throw new AnalysisActionError("Add a short reason first."); return note.trim(); };
  const revision = snapshot.revisions.find((item) => item.id === snapshot.revision_id);
  return <Panel>
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-0 flex-1 basis-48"><span className="sr-only">Search transcript</span>
        <input className="field" onChange={(event) => setQuery(event.target.value)} placeholder="Search transcript" type="search" value={query} /></label>
      {query.trim() ? <div className="flex items-center gap-1 text-sm text-task-text-muted">
        <span aria-live="polite">{matches.length ? `${hit + 1} of ${matches.length}` : "No matches"}</span>
        <Button aria-label="Previous match" className="size-11 p-0" disabled={!matches.length} onClick={() => setHit((value) => (value - 1 + matches.length) % matches.length)} type="button" variant="ghost"><ChevronUp aria-hidden /></Button>
        <Button aria-label="Next match" className="size-11 p-0" disabled={!matches.length} onClick={() => setHit((value) => (value + 1) % matches.length)} type="button" variant="ghost"><ChevronDown aria-hidden /></Button>
      </div> : null}
      <select aria-label="Transcript text" className="field w-auto" onChange={(event) => setView(event.target.value as TextView)} value={view}>
        <option value="readable">Readable</option><option value="original">Original language</option><option value="english">English</option></select>
      {snapshot.revisions.length > 1 ? <select aria-label="Transcript version" className="field w-auto" onChange={(event) => onRevision(event.target.value)} value={snapshot.revision_id ?? ""}>
        {snapshot.revisions.map((r) => <option key={r.id} value={r.id}>Version {r.revision} · {r.source === "machine" ? "automatic" : "corrected"}</option>)}</select> : null}
      {reviewer && snapshot.revision_id === latest?.id ? <Button disabled={busy} onClick={() => { setEditing((value) => !value); setDraft({}); }} type="button" variant="secondary">{editing ? "Cancel correction" : "Correct transcript"}</Button> : null}
    </div>
    {revision?.reason ? <p className="mt-2 text-xs text-task-text-muted">Correction reason: {revision.reason}</p> : null}
    {message ? <div className="mt-3"><Notice tone="success">{message}</Notice></div> : null}
    {error ? <div className="mt-3"><Notice tone="danger">{error}</Notice></div> : null}
    <ol className="mt-4 space-y-1">{segments.map((segment) => {
      const d = draft[segment.segment_id];
      const isHit = matches[hit] === segment.segment_id;
      return <li className={cn("rounded-xl border-l-2 px-3 py-2", active === segment.segment_id || isHit ? "border-gold bg-gold/10" : "border-transparent")} id={`seg-${segment.segment_id}`} key={segment.segment_id}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-task-text-muted">
          <button aria-label={playable ? `Play from ${formatAudioOffset(segment.start_ms)}` : `Go to ${formatAudioOffset(segment.start_ms)}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1.5 font-mono font-semibold tabular-nums text-gold-secondary hover:bg-gold/10" onClick={() => onSeek(segment.segment_id)} type="button">{formatAudioOffset(segment.start_ms)}</button>
          {segment.speaker !== "unknown" ? <span className="font-semibold text-task-text">{SPEAKER[segment.speaker]}{segment.speaker_source === "manual" ? " (corrected)" : ""}</span> : <span>Unknown speaker</span>}
          {segment.stt_confidence !== null && segment.stt_confidence < 0.6 ? <span className="text-warning">· unclear audio</span> : null}
        </div>
        {editing ? <div className="mt-1 grid gap-2 md:grid-cols-[auto_1fr]">
          <select aria-label="Speaker" className="field w-auto" onChange={(event) => setDraft({ ...draft, [segment.segment_id]: { speaker: event.target.value as SpeakerRole, raw_text: d?.raw_text ?? segment.raw_text } })} value={d?.speaker ?? segment.speaker}>
            {(Object.keys(SPEAKER) as SpeakerRole[]).map((s) => <option key={s} value={s}>{SPEAKER[s]}</option>)}</select>
          <textarea aria-label="Words spoken" className="field min-h-16" onChange={(event) => setDraft({ ...draft, [segment.segment_id]: { speaker: d?.speaker ?? segment.speaker, raw_text: event.target.value } })} value={d?.raw_text ?? segment.raw_text} />
        </div> : <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-task-text">{segmentText(segment, view)}</p>}
      </li>; })}</ol>
    {reviewer ? <div className="mt-4 space-y-3 border-t border-task-border pt-4">
      <label className="block"><span className="label">Reason (needed to correct or transcribe again)</span>
        <textarea className="field min-h-16" maxLength={500} onChange={(event) => setNote(event.target.value)} value={note} /></label>
      <div className="flex flex-wrap gap-2">
        {editing && latest ? <Button disabled={busy} onClick={() => void act(async () => {
          const changes = segments.flatMap((segment) => { const d = draft[segment.segment_id]; if (!d) return [];
            const change: { segment_id: string; speaker?: SpeakerRole; raw_text?: string } = { segment_id: segment.segment_id };
            if (d.speaker !== segment.speaker) change.speaker = d.speaker;
            if (d.raw_text.trim() !== segment.raw_text) change.raw_text = d.raw_text.trim();
            return Object.keys(change).length > 1 ? [change] : []; });
          if (!changes.length) throw new AnalysisActionError("Nothing was changed.");
          await correctTranscript(sessionId, latest.id, changes, needNote()); setEditing(false); setNote(""); onRevision(undefined); return "Correction saved as a new version. The original stays on record.";
        })} type="button">Save correction</Button> : null}
        <Button disabled={busy} onClick={() => void act(async () => { await requestReprocess(sessionId, needNote()); setNote(""); return "Sent to be transcribed again. The current text stays until the new one is ready."; })} type="button" variant="ghost">Transcribe audio again</Button>
      </div>
      <p className="text-xs text-task-text-muted">Corrections create a new version; scores change only after you request a rescore on the Coaching tab.</p>
    </div> : null}
  </Panel>;
}

function CoachingTab({ analyses, analysis, card, snapshot, segments, onSeek, reviewer, sessionId, onAnalysis, onChanged }: {
  analyses: readonly StoredSalesAnalysis[]; analysis: StoredSalesAnalysis | null; card: ConversationCard; snapshot: AnalysisSnapshot; segments: readonly AnalysisTranscriptSegment[];
  onSeek: (id: string) => void; reviewer: boolean; sessionId: string; onAnalysis: (id: string) => void; onChanged: () => void;
}) {
  const dims = analysis?.dimensions ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!analysis) return <NoReview card={card} reviewer={reviewer} snapshot={snapshot} />;
  const allOpen = dims.length > 0 && dims.every((d) => open[d.dimension_key]);
  const o = hasAnalysisOutput(analysis) ? analysis.output : null;
  const editTotal = analysis.reviews?.filter((r) => r.action === "edit").at(-1)?.reviewed_total;
  return <div className="space-y-4">
    <Panel>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wider text-task-text-muted">MK Sales Score</p>
          <p className="text-3xl font-semibold tabular-nums text-task-text">{analysis.raw_total === null ? "No score" : <>{analysis.raw_total.toFixed(1)}<span className="text-base text-task-text-muted"> / 100</span></>}</p>
          {editTotal != null ? <p className="text-sm text-task-text">Manager score: {editTotal.toFixed(1)}</p> : null}</div>
        {analyses.length > 1 ? <select aria-label="Analysis version" className="field w-auto" onChange={(event) => onAnalysis(event.target.value)} value={analysis.id}>
          {analyses.map((item, index) => <option key={item.id} value={item.id}>Review {index + 1} · {new Date(item.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</option>)}</select> : null}
      </div>
      {analysis.status_reasons.length ? <ul className="mt-2 list-disc pl-5 text-sm text-task-text-muted">{analysis.status_reasons.map((reason) => <li key={reason}>{QUALITY_REASON[reason] ?? reason}</li>)}</ul> : null}
      <p className="mt-2 text-xs text-task-text-muted">{reviewer ? `Rubric v${analysis.rubric_version} · ${analysis.sop_version ? `SOP v${analysis.sop_version}` : "No approved SOP"} · ${analysis.analyzer_model}${analysis.fallback_used ? " · backup reviewer" : ""} · scored over ${analysis.assessed_weight}% of the rubric. ` : analysis.review_state ? `${REVIEW[analysis.review_state]} by your manager. ` : ""}This is an AI recommendation, not a verified result.</p>
    </Panel>

    {dims.length ? <Panel action={<Button onClick={() => setOpen(allOpen ? {} : Object.fromEntries(dims.map((d) => [d.dimension_key, true])))} type="button" variant="ghost">{allOpen ? "Collapse all" : "Expand all"}</Button>} title="Scores by area">
      <div className="space-y-2">{dims.map((d) => <Disclosure key={d.dimension_key}
        meta={<span className="w-24 shrink-0 text-right text-sm tabular-nums text-task-text">{d.rating === null ? <span className="text-xs text-task-text-muted">{DIM_STATUS[d.status]}</span> : `${d.rating}/10`}</span>}
        onToggle={(value) => setOpen({ ...open, [d.dimension_key]: value })} open={Boolean(open[d.dimension_key])} summary={d.label}>
        {d.rating !== null ? <Meter label={`${d.label}: ${d.rating} out of 10`} max={10} value={d.rating} /> : null}
        <p className="mt-2 text-sm text-task-text">{d.reason}</p>
        {reviewer ? <p className="mt-1 text-xs text-task-text-muted">Weight {d.configured_weight}%{d.effective_weight !== null ? ` → ${Number(d.effective_weight).toFixed(1)}%` : ""}</p> : null}
        <Evidence onSeek={onSeek} refs={d.evidence} segments={segments} />
      </Disclosure>)}</div>
    </Panel> : null}

    {o ? <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Done well">{o.coaching_strengths.length ? <ul className="space-y-2 text-sm text-task-text">{o.coaching_strengths.map((c, i) => <li key={i}>{c.text}<Evidence onSeek={onSeek} refs={c.evidence} segments={segments} /></li>)}</ul> : <p className="text-sm text-task-text-muted">Nothing specific noted.</p>}</Panel>
      <Panel title="To improve">{o.coaching_gaps.length ? <ul className="space-y-2 text-sm text-task-text">{o.coaching_gaps.map((c, i) => <li key={i}>{c.text}<Evidence onSeek={onSeek} refs={c.evidence} segments={segments} /></li>)}</ul> : <p className="text-sm text-task-text-muted">Nothing specific noted.</p>}</Panel>
    </div> : null}
    {o?.coaching_interventions.length ? <Panel title="Try saying">
      <ul className="space-y-3">{o.coaching_interventions.map((c, i) => <li className="flex gap-2 rounded-xl bg-gold/10 p-3" key={i}><Lightbulb aria-hidden className="mt-0.5 size-4 shrink-0 text-gold-secondary" />
        <div className="min-w-0"><p className="text-sm font-semibold text-task-text">{c.text}</p><p className="text-sm text-task-text-muted">{c.reason}</p><Evidence onSeek={onSeek} refs={c.evidence} segments={segments} /></div></li>)}</ul>
    </Panel> : null}
    {o?.policy_findings.length ? <Panel title="SOP checks">
      <ul className="space-y-2 text-sm text-task-text">{o.policy_findings.map((f, i) => <li key={i}><Tag tone={f.severity === "high" ? "attention" : "neutral"}>{f.severity === "high" ? "Important" : f.severity === "medium" ? "Check" : "Minor"}</Tag> <span className="text-task-text-muted">Clause {f.clause_id}:</span> {f.statement}<Evidence onSeek={onSeek} refs={f.evidence} segments={segments} /></li>)}</ul>
    </Panel> : null}
    {reviewer ? <ManagerReview analyses={analyses} analysis={analysis} onChanged={onChanged} sessionId={sessionId} snapshot={snapshot} /> : null}
  </div>;
}

function ManagerReview({ analysis, analyses, snapshot, sessionId, onChanged }: { analysis: StoredSalesAnalysis; analyses: readonly StoredSalesAnalysis[]; snapshot: AnalysisSnapshot; sessionId: string; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useFlash();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, { status: SalesDimensionStatus; rating: string; reason: string }>>({});
  const previous = analysis.supersedes_id ? analyses.find((item) => item.id === analysis.supersedes_id) ?? null : null;
  const change = useMemo(() => (previous ? compareSalesAnalyses(previous, analysis) : null), [analysis, previous]);
  const pending = snapshot.jobs.some((job) => job.state === "pending" || job.state === "leased");
  const dead = snapshot.jobs.filter((job) => job.state === "dead").at(-1);
  const act = async (action: () => Promise<string>) => {
    if (busy) return; setBusy(true); setError(null);
    try { setMessage(await action()); onChanged(); } catch (cause) { setError(cause instanceof AnalysisActionError ? cause.message : "That could not be saved."); } finally { setBusy(false); }
  };
  const needNote = () => { if (note.trim().length < 3) throw new AnalysisActionError("Add a short reason first."); return note.trim(); };
  return <Panel description="Staff see the summary and coaching only after you approve or edit it." title="Manager review">
    <div className="space-y-3">
      {pending ? <Notice tone="task">A new review is being prepared. This page refreshes on its own.</Notice> : null}
      {dead ? <Notice tone="danger">The last review attempt failed. Request a rescore to try again.</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <label className="block"><span className="label">Reason or note (needed to flag, comment, edit scores or rescore)</span>
        <textarea className="field min-h-16" maxLength={2000} onChange={(event) => setNote(event.target.value)} value={note} /></label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void act(async () => { await reviewAnalysis(analysis.id, "approve", note.trim() || null); setNote(""); return "Approved. The salesperson can now see this review."; })} type="button">{analysis.review_state === "approve" ? "Approve again" : "Approve"}</Button>
        {analysis.review_state === "flag"
          ? <Button disabled={busy} onClick={() => void act(async () => { await reviewAnalysis(analysis.id, "unflag", note.trim() || null); setNote(""); return "Flag removed."; })} type="button" variant="secondary">Remove flag</Button>
          : <Button disabled={busy} onClick={() => void act(async () => { await reviewAnalysis(analysis.id, "flag", needNote()); setNote(""); return "Flagged."; })} type="button" variant="secondary">Flag</Button>}
        <Button disabled={busy} onClick={() => void act(async () => { await reviewAnalysis(analysis.id, "comment", needNote()); setNote(""); return "Comment saved."; })} type="button" variant="secondary">Comment</Button>
        <Button disabled={busy} onClick={() => { setEditing((value) => !value); setOverrides({}); }} type="button" variant="secondary">Edit scores</Button>
        <Button disabled={busy} onClick={() => void act(async () => { const r = await requestRescore(sessionId, needNote()); setNote(""); return r.alreadyRequested ? "This rescore was already requested with the same transcript, rubric and SOP." : "Rescore requested. The earlier review is kept."; })} type="button" variant="secondary">Request rescore</Button>
      </div>
      {editing ? <div className="space-y-2">{analysis.dimensions?.map((d) => {
        const o = overrides[d.dimension_key];
        const update = (patch: Partial<{ status: SalesDimensionStatus; rating: string; reason: string }>) => setOverrides({ ...overrides, [d.dimension_key]: { status: o?.status ?? d.status, rating: o?.rating ?? String(d.rating ?? ""), reason: o?.reason ?? "", ...patch } });
        return <fieldset className="grid gap-2 rounded-xl border border-task-border p-3 md:grid-cols-[1fr_auto_auto]" key={d.dimension_key}><legend className="px-1 text-sm font-semibold text-task-text">{d.label}</legend>
          <input aria-label={`${d.label} reason`} className="field" onChange={(e) => update({ reason: e.target.value })} placeholder="Why you changed it (leave empty to keep)" value={o?.reason ?? ""} />
          <select aria-label={`${d.label} status`} className="field w-auto" onChange={(e) => update({ status: e.target.value as SalesDimensionStatus })} value={o?.status ?? d.status}>
            {(Object.keys(DIM_STATUS) as SalesDimensionStatus[]).map((s) => <option key={s} value={s}>{DIM_STATUS[s]}</option>)}</select>
          <input aria-label={`${d.label} rating`} className="field w-24" disabled={(o?.status ?? d.status) !== "assessed"} inputMode="numeric" max={10} min={0} onChange={(e) => update({ rating: e.target.value })} type="number" value={o?.rating ?? String(d.rating ?? "")} />
        </fieldset>; })}
        <Button disabled={busy} onClick={() => void act(async () => {
          const list: DimensionOverride[] = Object.entries(overrides).filter(([, v]) => v.reason.trim()).map(([key, v]) => ({ key, status: v.status, rating: v.status === "assessed" ? Number(v.rating) : null, reason: v.reason.trim() }));
          if (!list.length) throw new AnalysisActionError("Give a reason for each area you change.");
          if (list.some((item) => item.rating !== null && (!Number.isInteger(item.rating) || item.rating < 0 || item.rating > 10))) throw new AnalysisActionError("Ratings are whole numbers from 0 to 10.");
          await reviewAnalysis(analysis.id, "edit", needNote(), list); setEditing(false); setNote(""); return "Manager scores saved. The AI scores stay on record.";
        })} type="button">Save manager scores</Button></div> : null}
      {change ? <Block title="Changes from the previous review"><ul className="list-disc pl-5 text-sm text-task-text">
        {change.total.delta !== null ? <li>Score {change.total.from?.toFixed(1)} → {change.total.to?.toFixed(1)} ({change.total.delta > 0 ? "+" : ""}{change.total.delta})</li> : null}
        {change.inputs.map((input) => <li key={input.field}>{input.field.replace("_", " ")} changed</li>)}
        {change.dimensions.map((d) => <li key={d.key}>{d.label}: {d.from?.rating ?? (d.from ? DIM_STATUS[d.from.status] : "—")} → {d.to?.rating ?? (d.to ? DIM_STATUS[d.to.status] : "—")}</li>)}
      </ul></Block> : null}
      {analysis.reviews?.length ? <Block title="Review history"><ul className="space-y-1 text-sm text-task-text">{analysis.reviews.map((r) => <li key={r.id}>{new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {REVIEW[r.action]}{r.reviewed_total != null ? ` · ${r.reviewed_total.toFixed(1)}` : ""}{r.note ? ` · ${r.note}` : ""}</li>)}</ul></Block> : null}
    </div>
  </Panel>;
}

function ActionsTab({ analysis, card, links, segments, onSeek, onChanged, reviewer }: { analysis: StoredSalesAnalysis | null; card: ConversationCard; links: readonly ActionTaskLink[]; segments: readonly AnalysisTranscriptSegment[]; onSeek: (id: string) => void; onChanged: () => void; reviewer: boolean }) {
  const [choosing, setChoosing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useFlash();
  const [error, setError] = useState<string | null>(null);
  if (!analysis || !hasAnalysisOutput(analysis)) return <Panel><p className="text-sm text-task-text-muted">{card.awaiting_review ? "Suggested follow-ups appear after your manager reviews this conversation." : "No suggested follow-ups yet."}</p></Panel>;
  const actions = analysis.output.next_best_actions;
  const released = analysis.review_state === "approve" || analysis.review_state === "edit";
  const create = async (index: number, at: string) => {
    setBusy(true); setError(null);
    try { const result = await createActionTask(analysis.id, index, at); setMessage(result.alreadyCreated ? "This follow-up already has a task." : "Follow-up task created. It is in Tasks for the salesperson."); setChoosing(null); onChanged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The task could not be created."); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    {reviewer && !released ? <Panel><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-task-text">Approve this review so the salesperson can see these suggestions.</p>
      <Button disabled={busy} onClick={() => void (async () => { setBusy(true); setError(null); try { await reviewAnalysis(analysis.id, "approve", null); setMessage("Approved. The salesperson can now see this review."); onChanged(); } catch (cause) { setError(cause instanceof AnalysisActionError ? cause.message : "Approval did not save."); } finally { setBusy(false); } })()} type="button">Approve review</Button></div></Panel> : null}
    {message ? <Notice tone="success">{message}</Notice> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {card.retention_expired ? <Notice tone="task">This conversation is past its retention period, so new tasks cannot be created from it.</Notice> : null}
    {actions.length ? <ul className="space-y-3">{actions.map((item, index) => {
      const link = links.find((l) => l.analysis_id === analysis.id && l.action_index === index);
      return <li key={index}><Panel>
        <p className="text-base font-semibold text-task-text">{item.action}</p>
        <p className="mt-0.5 text-sm text-task-text-muted">{item.reason}</p>
        <Evidence onSeek={onSeek} refs={item.evidence} segments={segments} />
        <div className="mt-3">
          {link ? <Tag tone={link.task_status === "completed" ? "success" : "progress"}>{taskStatusLabel(link)}{link.planned_datetime ? ` · due ${new Date(link.planned_datetime).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}` : ""}</Tag>
            : choosing === index ? <fieldset><legend className="mb-2 text-xs font-semibold text-task-text-muted">When should it be done?</legend>
              <div className="flex flex-wrap gap-2">{followUpChoices().map((choice) => <Button disabled={busy} key={choice.key} onClick={() => void create(index, choice.at)} type="button" variant="secondary">{choice.label}</Button>)}
                <Button disabled={busy} onClick={() => setChoosing(null)} type="button" variant="ghost">Cancel</Button></div></fieldset>
            : <Button disabled={card.retention_expired || (!reviewer && !released)} onClick={() => setChoosing(index)} type="button">Create follow-up task</Button>}
        </div>
      </Panel></li>; })}</ul>
      : <Panel><p className="text-sm text-task-text-muted">No follow-ups were suggested for this conversation.</p></Panel>}
    <p className="text-xs text-task-text-muted">Each suggestion can become one task, assigned to the salesperson. Tapping again never creates a duplicate.</p>
  </div>;
}

function CustomerDrawer({ card, analysis, segments, onClose, onSeek, onLinked }: { card: ConversationCard; analysis: StoredSalesAnalysis | null; segments: readonly AnalysisTranscriptSegment[]; onClose: () => void; onSeek: (id: string) => void; onLinked: () => void }) {
  const { access } = useAuth();
  const canLink = hasPermission(access, "crm.view") && !card.customer_linked && !card.retention_expired;
  const walkins = useLoad(async () => (canLink ? recordingWalkins() : []), [canLink]);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const o = analysis && hasAnalysisOutput(analysis) ? analysis.output : null;
  return <Drawer onClose={onClose} title="Customer details">
    <div className="space-y-5 text-sm">
      <section className="space-y-1.5"><h3 className="font-semibold text-task-text">CRM</h3>
        {card.customer_linked ? <p className="text-task-text">Linked to a CRM walk-in.</p> : <p className="text-task-text-muted">Not linked to a CRM walk-in.</p>}
        {canLink ? <div className="space-y-2">
          <select aria-label="CRM walk-in" className="field" onChange={(event) => setChoice(event.target.value)} value={choice}><option value="">Choose a walk-in</option>{(walkins.data ?? []).map((w) => <option key={w.ref} value={w.ref}>{w.label}</option>)}</select>
          {error ? <p className="text-danger" role="alert">{error}</p> : null}
          <Button disabled={!choice || busy} onClick={() => void (async () => { setBusy(true); setError(null); try { await linkRecordingWalkin(card.id, choice); onLinked(); onClose(); } catch { setError("The walk-in could not be linked."); } finally { setBusy(false); } })()} type="button">Link walk-in</Button>
          {walkins.data && !walkins.data.length ? <p className="text-xs text-task-text-muted">No CRM walk-ins you can link right now.</p> : null}
        </div> : null}
      </section>
      {o ? <>
        <section className="space-y-1.5"><h3 className="font-semibold text-task-text">Looking for</h3>
          {o.product_interests.length || o.customer_requirements.requirements.length ? <ul className="space-y-1.5 text-task-text">{[...o.product_interests, ...o.customer_requirements.requirements].map((c, i) => <li key={i}>{c.text}<Evidence onSeek={onSeek} refs={c.evidence} segments={segments} /></li>)}</ul> : <p className="text-task-text-muted">Not stated.</p>}</section>
        <section className="space-y-1.5"><h3 className="font-semibold text-task-text">Occasion</h3>{o.customer_requirements.occasion ? <p className="text-task-text">{o.customer_requirements.occasion.text}</p> : <p className="text-task-text-muted">Not stated.</p>}</section>
        <section className="space-y-1.5"><h3 className="font-semibold text-task-text">Budget</h3>{o.customer_requirements.budget ? <p className="text-task-text">{o.customer_requirements.budget.text} <span className="text-task-text-muted">(as the customer said it)</span></p> : <p className="text-task-text-muted">Not stated. We never guess a budget.</p>}</section>
      </> : <p className="text-task-text-muted">Details appear after the conversation is reviewed.</p>}
    </div>
  </Drawer>;
}
