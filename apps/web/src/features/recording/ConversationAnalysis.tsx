import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  SALES_SIGNAL_KEYS, compareSalesAnalyses, evidenceSeekTargets, formatAudioOffset, hasAnalysisOutput,
  type AnalysisSnapshot, type AnalysisTranscriptSegment, type EvidenceRef, type SalesDimensionStatus, type SpeakerRole, type StoredSalesAnalysis,
} from "@jewelos/core";
import { AnalysisActionError, correctTranscript, fetchAnalysisSnapshot, requestReprocess, requestRescore, reviewAnalysis, type DimensionOverride } from "@jewelos/data";
import { Button, Notice } from "@/components/ui";

const STATUS: Readonly<Record<StoredSalesAnalysis["status"], string>> = { scored: "Scored", needs_review: "Needs review", insufficient_evidence: "Not enough evidence" };
const REASON: Readonly<Record<string, string>> = {
  too_little_speech: "Too little speech to judge",
  analyzer_insufficient: "The reviewer model could not judge this conversation",
  too_little_assessed_weight: "Too few parts of the conversation could be scored",
  low_stt_confidence: "Audio was hard to transcribe",
  speaker_unverified: "Speakers could not be told apart",
  fallback_model: "A backup model was used",
  high_policy_finding: "Possible SOP contradiction",
  analyzer_low_confidence: "Low confidence review",
};
const REVIEW: Readonly<Record<string, string>> = { approve: "Approved", flag: "Flagged", unflag: "Flag removed", edit: "Edited by manager", comment: "Comment" };
const SPEAKER: Readonly<Record<SpeakerRole, string>> = { employee: "Employee", customer: "Customer", unknown: "Unknown speaker" };
const SIGNAL: Readonly<Record<string, string>> = {
  objection: "Objection", price_concern: "Price concern", stock_gap: "Stock gap", competitor_mention: "Competitor mentioned",
  customer_questions: "Customer questions", conversion_signal: "Buying signal", next_step: "Next step agreed", drop_off: "Customer dropped off",
  upsell_opportunity: "Upsell opportunity",
};
const OUTCOME: Readonly<Record<string, string>> = { unknown: "Unknown", enquiry: "Enquiry", follow_up: "Follow-up", reported_purchase: "Purchase mentioned", no_purchase: "No purchase" };
const DIM_STATUS: Readonly<Record<SalesDimensionStatus, string>> = { assessed: "Scored", not_applicable: "Not applicable", insufficient_evidence: "Not enough evidence" };
type TextView = "original" | "readable" | "english";

function segmentText(segment: AnalysisTranscriptSegment, view: TextView): string {
  if (view === "readable") return segment.display_text ?? segment.raw_text;
  if (view === "english") return segment.translation_en ?? segment.display_text ?? segment.raw_text;
  return segment.raw_text;
}

function Evidence({ refs, segments, onSeek }: { refs: readonly EvidenceRef[]; segments: readonly AnalysisTranscriptSegment[]; onSeek: (id: string) => void }) {
  const targets = evidenceSeekTargets(refs, segments);
  if (!targets.length) return null;
  return <span className="mt-1 flex flex-wrap gap-1">{targets.map((target, index) =>
    <button className="min-h-8 max-w-full truncate rounded-md border border-task-border px-2 text-left text-xs text-task-text-muted hover:border-gold/60 hover:text-task-text"
      key={`${target.segment_id}-${index}`} onClick={() => onSeek(target.segment_id)} title={target.quote} type="button">
      {formatAudioOffset(target.start_ms)} · “{target.quote}”
    </button>)}</span>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-1"><h4 className="text-sm font-semibold text-task-text">{title}</h4>{children}</div>;
}

export function ConversationAnalysis({ sessionId }: { sessionId: string }) {
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [revisionId, setRevisionId] = useState<string | undefined>(undefined);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
  const [view, setView] = useState<TextView>("readable");
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<"none" | "transcript" | "scores">("none");
  const [draft, setDraft] = useState<Record<string, { speaker: SpeakerRole; raw_text: string }>>({});
  const [overrides, setOverrides] = useState<Record<string, { status: SalesDimensionStatus; rating: string; reason: string }>>({});

  const load = useCallback(async () => {
    try { setSnapshot(await fetchAnalysisSnapshot(sessionId, revisionId)); setError(null); }
    catch { setError("Conversation review is unavailable for this recording."); }
  }, [sessionId, revisionId]);
  useEffect(() => { setSnapshot(null); setRevisionId(undefined); setAnalysisId(null); setEditing("none"); setNote(""); setNotice(null); }, [sessionId]);
  useEffect(() => {
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const tick = async () => { await load(); if (!cancelled) timer = setTimeout(() => { void tick(); }, 15000); };
    void tick(); return () => { cancelled = true; clearTimeout(timer); };
  }, [load]);

  const segments = snapshot?.segments ?? [];
  const analyses = snapshot?.analyses ?? [];
  const analysis = analyses.find((item) => item.id === analysisId) ?? analyses.at(-1) ?? null;
  const previous = analysis?.supersedes_id ? analyses.find((item) => item.id === analysis.supersedes_id) ?? null : null;
  const change = useMemo(() => (analysis && previous ? compareSalesAnalyses(previous, analysis) : null), [analysis, previous]);
  const pending = snapshot?.jobs.filter((job) => job.state === "pending" || job.state === "leased") ?? [];
  const dead = snapshot?.jobs.filter((job) => job.state === "dead").at(-1);
  const reviewer = snapshot?.is_reviewer ?? false;
  const latestRevision = snapshot?.revisions.at(-1);

  const seek = (id: string) => {
    if (snapshot && snapshot.revision_id !== analysis?.transcript_revision_id && analysis) setRevisionId(analysis.transcript_revision_id);
    setActive(id);
    requestAnimationFrame(() => document.getElementById(`analysis-seg-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };
  const act = async (action: () => Promise<string | void>) => {
    if (busy) return; setBusy(true); setError(null); setNotice(null);
    try { const message = await action(); if (message) setNotice(message); await load(); }
    catch (cause) { setError(cause instanceof AnalysisActionError ? cause.message : "The action could not be completed."); }
    finally { setBusy(false); }
  };
  const needNote = () => { if (note.trim().length < 3) throw new AnalysisActionError("Add a short reason first."); return note.trim(); };

  if (error && !snapshot) return <Notice tone="neutral">{error}</Notice>;
  if (!snapshot) return <p className="text-sm text-task-text-muted">Loading conversation review…</p>;
  if (!snapshot.revisions.length) return <section aria-label="Conversation review" className="rounded-2xl border border-task-border bg-task-bg p-4 text-sm text-task-text-muted md:p-6">
    The final transcript is not ready yet. Review and scoring appear after processing finishes.</section>;

  return <section aria-label="Conversation review" className="space-y-5 rounded-2xl border border-task-border bg-task-bg p-4 md:p-6">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-task-text">Conversation review</h2>
      {analyses.length > 1 ? <select aria-label="Analysis version" className="min-h-10 max-w-full rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(event) => setAnalysisId(event.target.value)} value={analysis?.id ?? ""}>
        {analyses.map((item, index) => <option key={item.id} value={item.id}>Analysis {index + 1} · {new Date(item.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</option>)}</select> : null}</div>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {notice ? <Notice tone="success">{notice}</Notice> : null}
    {pending.length ? <Notice tone="neutral">Analysis is queued or running. This page refreshes on its own.</Notice> : null}
    {reviewer && dead ? <Notice tone="danger">The last analysis attempt failed ({dead.error_code ?? "unknown error"}). Request a rescore to try again.</Notice> : null}
    {reviewer ? <div className="space-y-1"><label className="block text-sm text-task-text" htmlFor="analysis-note">Reason or note (needed for flag, comment, score edits, corrections, rescore and transcribing again)</label>
      <textarea className="min-h-16 w-full rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" id="analysis-note" maxLength={2000} onChange={(e) => setNote(e.target.value)} value={note} /></div> : null}

    {analysis ? <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <div><p className="text-xs uppercase tracking-wide text-task-text-muted">MK Sales Score</p>
          <p className="text-3xl font-semibold tabular-nums text-task-text">{analysis.raw_total === null ? "No score" : <>{analysis.raw_total.toFixed(1)}<span className="text-base text-task-text-muted"> / 100</span></>}</p></div>
        <p className={`text-sm font-semibold ${analysis.status === "needs_review" ? "text-danger" : "text-task-text"}`}>{STATUS[analysis.status]}{analysis.review_state ? ` · ${REVIEW[analysis.review_state]}` : ""}</p>
        {analysis.reviews?.filter((r) => r.action === "edit").at(-1)?.reviewed_total != null ? <p className="text-sm text-task-text">Manager score: {analysis.reviews.filter((r) => r.action === "edit").at(-1)?.reviewed_total?.toFixed(1)}</p> : null}
      </div>
      {analysis.status_reasons.length ? <ul className="list-disc pl-5 text-sm text-task-text-muted">{analysis.status_reasons.map((reason) => <li key={reason}>{REASON[reason] ?? reason}</li>)}</ul> : null}
      <p className="text-xs text-task-text-muted">Rubric v{analysis.rubric_version} · {analysis.sop_version ? `SOP v${analysis.sop_version}` : "No approved SOP"} · {analysis.analyzer_model} · {analysis.prompt_version}{analysis.fallback_used ? " · backup model" : ""} · scored over {analysis.assessed_weight}% of the rubric. This is an AI recommendation, not a verified result.</p>
      {change ? <Block title="Changes from the previous analysis"><ul className="list-disc pl-5 text-sm text-task-text">
        {change.total.delta !== null ? <li>Score {change.total.from?.toFixed(1)} → {change.total.to?.toFixed(1)} ({change.total.delta > 0 ? "+" : ""}{change.total.delta})</li> : null}
        {change.status ? <li>{STATUS[change.status.from]} → {STATUS[change.status.to]}</li> : null}
        {change.inputs.map((input) => <li key={input.field}>{input.field.replace("_", " ")} changed</li>)}
        {change.dimensions.map((d) => <li key={d.key}>{d.label}: {d.from?.rating ?? (d.from ? DIM_STATUS[d.from.status] : "—")} → {d.to?.rating ?? (d.to ? DIM_STATUS[d.to.status] : "—")}</li>)}
      </ul></Block> : null}

      {analysis.dimensions?.length ? <Block title="Scores by area"><ul className="divide-y divide-task-border">{analysis.dimensions.map((d) =>
        <li className="py-2" key={d.dimension_key}><div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium text-task-text">{d.label}</span>
          <span className="tabular-nums text-task-text">{d.rating === null ? DIM_STATUS[d.status] : `${d.rating}/10`} <span className="text-task-text-muted">· weight {d.configured_weight}%{d.effective_weight !== null ? ` → ${Number(d.effective_weight).toFixed(1)}%` : ""}</span></span></div>
          <p className="text-sm text-task-text-muted">{d.reason}</p><Evidence onSeek={seek} refs={d.evidence} segments={segments} /></li>)}</ul></Block> : null}

      {hasAnalysisOutput(analysis) ? <div className="grid gap-4 md:grid-cols-2">
        <Block title="Summary"><p className="text-sm text-task-text">{analysis.output.summary}</p></Block>
        <Block title="Key points"><ul className="space-y-1 text-sm text-task-text">{analysis.output.key_points.map((c, i) => <li key={i}>{c.text}<Evidence onSeek={seek} refs={c.evidence} segments={segments} /></li>)}</ul></Block>
        <Block title="Customer needs"><ul className="space-y-1 text-sm text-task-text">
          {analysis.output.customer_requirements.budget ? <li>Budget: {analysis.output.customer_requirements.budget.text}<Evidence onSeek={seek} refs={analysis.output.customer_requirements.budget.evidence} segments={segments} /></li> : null}
          {analysis.output.customer_requirements.occasion ? <li>Occasion: {analysis.output.customer_requirements.occasion.text}<Evidence onSeek={seek} refs={analysis.output.customer_requirements.occasion.evidence} segments={segments} /></li> : null}
          {[...analysis.output.customer_requirements.requirements, ...analysis.output.product_interests].map((c, i) => <li key={i}>{c.text}<Evidence onSeek={seek} refs={c.evidence} segments={segments} /></li>)}
          {!analysis.output.customer_requirements.budget && !analysis.output.customer_requirements.occasion && !analysis.output.customer_requirements.requirements.length && !analysis.output.product_interests.length ? <li className="text-task-text-muted">Nothing stated clearly.</li> : null}
        </ul></Block>
        <Block title="Concerns and blockers"><ul className="space-y-1 text-sm text-task-text">
          {[...analysis.output.customer_concerns, ...analysis.output.purchase_blockers, ...analysis.output.competitor_mentions].map((c, i) => <li key={i}>{c.text}<Evidence onSeek={seek} refs={c.evidence} segments={segments} /></li>)}
          {!analysis.output.customer_concerns.length && !analysis.output.purchase_blockers.length && !analysis.output.competitor_mentions.length ? <li className="text-task-text-muted">None found.</li> : null}
        </ul></Block>
        <Block title="Coaching"><ul className="space-y-1 text-sm text-task-text">
          {analysis.output.coaching_strengths.map((c, i) => <li key={`s${i}`}>Strength: {c.text}<Evidence onSeek={seek} refs={c.evidence} segments={segments} /></li>)}
          {analysis.output.coaching_gaps.map((c, i) => <li key={`g${i}`}>Gap: {c.text}<Evidence onSeek={seek} refs={c.evidence} segments={segments} /></li>)}
          {analysis.output.coaching_interventions.map((c, i) => <li key={`c${i}`}><span className="font-medium">Try: {c.text}</span> <span className="text-task-text-muted">({c.reason})</span><Evidence onSeek={seek} refs={c.evidence} segments={segments} /></li>)}
        </ul></Block>
        <Block title="Next best actions"><ul className="space-y-1 text-sm text-task-text">{analysis.output.next_best_actions.length ? analysis.output.next_best_actions.map((a, i) => <li key={i}>{a.action} <span className="text-task-text-muted">({a.reason})</span><Evidence onSeek={seek} refs={a.evidence} segments={segments} /></li>) : <li className="text-task-text-muted">None suggested.</li>}</ul></Block>
        <Block title="Signals"><ul className="space-y-1 text-sm text-task-text">
          {SALES_SIGNAL_KEYS.filter((key) => analysis.output.signals[key].detected).map((key) => <li key={key}>{SIGNAL[key]} <span className="text-task-text-muted">({Math.round(analysis.output.signals[key].confidence * 100)}% · {analysis.output.signals[key].reason})</span><Evidence onSeek={seek} refs={analysis.output.signals[key].evidence} segments={segments} /></li>)}
          <li>Outcome: {OUTCOME[analysis.output.signals.sales_outcome.value]} <span className="text-task-text-muted">({Math.round(analysis.output.signals.sales_outcome.confidence * 100)}%)</span><Evidence onSeek={seek} refs={analysis.output.signals.sales_outcome.evidence} segments={segments} /></li>
        </ul></Block>
        {analysis.output.policy_findings.length ? <Block title="SOP findings"><ul className="space-y-1 text-sm text-task-text">{analysis.output.policy_findings.map((f, i) => <li key={i}><span className={f.severity === "high" ? "font-semibold text-danger" : "font-semibold"}>{f.severity.toUpperCase()}</span> · clause {f.clause_id} (SOP v{analysis.sop_version}): {f.statement}<Evidence onSeek={seek} refs={f.evidence} segments={segments} /></li>)}</ul></Block> : null}
      </div> : null}

      {reviewer ? <div className="space-y-3 rounded-xl border border-task-border p-3">
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void act(async () => { await reviewAnalysis(analysis.id, "approve", note.trim() || null); setNote(""); return "Approved. The employee can now see this review."; })} type="button">Approve</Button>
          {analysis.review_state === "flag"
            ? <Button disabled={busy} onClick={() => void act(async () => { await reviewAnalysis(analysis.id, "unflag", note.trim() || null); setNote(""); return "Flag removed."; })} type="button" variant="secondary">Remove flag</Button>
            : <Button disabled={busy} onClick={() => void act(async () => { await reviewAnalysis(analysis.id, "flag", needNote()); setNote(""); return "Flagged."; })} type="button" variant="secondary">Flag</Button>}
          <Button disabled={busy} onClick={() => void act(async () => { await reviewAnalysis(analysis.id, "comment", needNote()); setNote(""); return "Comment saved."; })} type="button" variant="secondary">Comment</Button>
          <Button disabled={busy} onClick={() => { setEditing(editing === "scores" ? "none" : "scores"); setOverrides({}); }} type="button" variant="secondary">Edit scores</Button>
          <Button disabled={busy} onClick={() => void act(async () => { const r = await requestRescore(sessionId, needNote()); setNote(""); return r.alreadyRequested ? "This rescore was already requested with the same transcript, rubric and SOP." : "Rescore requested. The earlier analysis is kept."; })} type="button" variant="secondary">Request rescore</Button>
        </div>
        {editing === "scores" ? <div className="space-y-2">{analysis.dimensions?.map((d) => {
          const o = overrides[d.dimension_key];
          return <fieldset className="grid gap-2 rounded-lg border border-task-border p-2 md:grid-cols-[1fr_auto_auto]" key={d.dimension_key}><legend className="px-1 text-sm text-task-text">{d.label}</legend>
            <input aria-label={`${d.label} reason`} className="min-h-10 rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(e) => setOverrides({ ...overrides, [d.dimension_key]: { status: o?.status ?? d.status, rating: o?.rating ?? String(d.rating ?? ""), reason: e.target.value } })} placeholder="Why you changed it (leave empty to keep)" value={o?.reason ?? ""} />
            <select aria-label={`${d.label} status`} className="min-h-10 rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(e) => setOverrides({ ...overrides, [d.dimension_key]: { status: e.target.value as SalesDimensionStatus, rating: o?.rating ?? String(d.rating ?? ""), reason: o?.reason ?? "" } })} value={o?.status ?? d.status}>
              {(Object.keys(DIM_STATUS) as SalesDimensionStatus[]).map((s) => <option key={s} value={s}>{DIM_STATUS[s]}</option>)}</select>
            <input aria-label={`${d.label} rating`} className="min-h-10 w-20 rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" disabled={(o?.status ?? d.status) !== "assessed"} inputMode="numeric" max={10} min={0} onChange={(e) => setOverrides({ ...overrides, [d.dimension_key]: { status: o?.status ?? d.status, rating: e.target.value, reason: o?.reason ?? "" } })} type="number" value={o?.rating ?? String(d.rating ?? "")} />
          </fieldset>; })}
          <Button disabled={busy} onClick={() => void act(async () => {
            const list: DimensionOverride[] = Object.entries(overrides).filter(([, v]) => v.reason.trim()).map(([key, v]) => ({ key, status: v.status, rating: v.status === "assessed" ? Number(v.rating) : null, reason: v.reason.trim() }));
            if (!list.length) throw new AnalysisActionError("Give a reason for each area you change.");
            if (list.some((item) => item.rating !== null && (!Number.isInteger(item.rating) || item.rating < 0 || item.rating > 10))) throw new AnalysisActionError("Ratings are whole numbers from 0 to 10.");
            await reviewAnalysis(analysis.id, "edit", needNote(), list); setEditing("none"); setNote(""); return "Manager scores saved. The AI scores stay on record.";
          })} type="button">Save manager scores</Button></div> : null}
        {analysis.reviews?.length ? <Block title="Review history"><ul className="space-y-1 text-sm text-task-text">{analysis.reviews.map((r) => <li key={r.id}>{new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {REVIEW[r.action]}{r.reviewed_total != null ? ` · ${r.reviewed_total.toFixed(1)}` : ""}{r.note ? ` · ${r.note}` : ""}</li>)}</ul></Block> : null}
      </div> : null}
    </div> : <p className="text-sm text-task-text-muted">{reviewer ? "No analysis yet." : "No approved review yet. Your manager reviews the AI analysis before you see it."}</p>}

    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-base font-semibold text-task-text">Final transcript</h3>
        <div className="flex flex-wrap gap-2">
          {snapshot.revisions.length > 1 ? <select aria-label="Transcript version" className="min-h-10 rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(e) => setRevisionId(e.target.value)} value={snapshot.revision_id ?? ""}>
            {snapshot.revisions.map((r) => <option key={r.id} value={r.id}>Version {r.revision} · {r.source === "machine" ? "machine" : "corrected"}</option>)}</select> : null}
          <select aria-label="Transcript text" className="min-h-10 rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(e) => setView(e.target.value as TextView)} value={view}>
            <option value="readable">Readable</option><option value="original">Original language</option><option value="english">English</option></select>
          {reviewer && snapshot.revision_id === latestRevision?.id ? <Button disabled={busy} onClick={() => { setEditing(editing === "transcript" ? "none" : "transcript"); setDraft({}); }} type="button" variant="secondary">{editing === "transcript" ? "Cancel correction" : "Correct transcript"}</Button> : null}
        </div></div>
      {snapshot.revisions.find((r) => r.id === snapshot.revision_id)?.reason ? <p className="text-xs text-task-text-muted">Correction reason: {snapshot.revisions.find((r) => r.id === snapshot.revision_id)?.reason}</p> : null}
      <ol className="space-y-2">{segments.map((segment) => {
        const d = draft[segment.segment_id];
        return <li className={`rounded-lg border-l-2 py-1 pl-3 ${active === segment.segment_id ? "border-gold bg-gold/10" : "border-task-border"}`} id={`analysis-seg-${segment.segment_id}`} key={segment.segment_id}>
          <span className="text-xs font-semibold text-task-text-muted">{formatAudioOffset(segment.start_ms)} · {SPEAKER[segment.speaker]}{segment.speaker_source === "manual" ? " (corrected)" : ""}{segment.stt_confidence !== null && segment.stt_confidence < 0.6 ? " · unclear audio" : ""}</span>
          {editing === "transcript" ? <div className="mt-1 grid gap-2 md:grid-cols-[auto_1fr]">
            <select aria-label="Speaker" className="min-h-10 rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(e) => setDraft({ ...draft, [segment.segment_id]: { speaker: e.target.value as SpeakerRole, raw_text: d?.raw_text ?? segment.raw_text } })} value={d?.speaker ?? segment.speaker}>
              {(Object.keys(SPEAKER) as SpeakerRole[]).map((s) => <option key={s} value={s}>{SPEAKER[s]}</option>)}</select>
            <textarea aria-label="Words spoken" className="min-h-16 rounded-lg border border-task-border bg-task-bg p-2 text-sm text-task-text" onChange={(e) => setDraft({ ...draft, [segment.segment_id]: { speaker: d?.speaker ?? segment.speaker, raw_text: e.target.value } })} value={d?.raw_text ?? segment.raw_text} />
          </div> : <p className="whitespace-pre-wrap break-words text-task-text">{segmentText(segment, view)}</p>}
        </li>; })}</ol>
      {editing === "transcript" && latestRevision ? <div className="space-y-2"><p className="text-sm text-task-text-muted">Saving creates a new transcript version. The original stays on record. Scores change only after you request a rescore.</p>
        <Button disabled={busy} onClick={() => void act(async () => {
          const changes = segments.flatMap((segment) => { const d = draft[segment.segment_id]; if (!d) return [];
            const change: { segment_id: string; speaker?: SpeakerRole; raw_text?: string } = { segment_id: segment.segment_id };
            if (d.speaker !== segment.speaker) change.speaker = d.speaker;
            if (d.raw_text.trim() !== segment.raw_text) change.raw_text = d.raw_text.trim();
            return Object.keys(change).length > 1 ? [change] : []; });
          if (!changes.length) throw new AnalysisActionError("Nothing was changed.");
          await correctTranscript(sessionId, latestRevision.id, changes, needNote()); setEditing("none"); setRevisionId(undefined); setNote(""); return "Correction saved as a new transcript version.";
        })} type="button">Save correction</Button></div> : null}
      {reviewer ? <Button disabled={busy} onClick={() => void act(async () => { await requestReprocess(sessionId, needNote()); setNote(""); return "Audio sent for transcription again. The current transcript stays until the new one is ready."; })} type="button" variant="ghost">Transcribe audio again</Button> : null}
      <p className="text-xs text-task-text-muted">Evidence buttons jump to the quoted line. Audio playback from evidence is not available yet.</p>
    </div>
  </section>;
}
