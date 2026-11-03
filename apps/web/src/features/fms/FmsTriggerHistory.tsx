import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { fmsAssignedWorkPath, fmsTriggerSource } from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import { inspectFmsTriggerEvent, loadFmsTriggerHistory, retryFmsTriggerEvent, type FmsTriggerEventDetail, type FmsTriggerHistory as History, type FmsTriggerOutcome } from "./triggerApi";

const OUTCOMES: Readonly<Record<FmsTriggerOutcome, Readonly<{ label: string; tone: string }>>> = {
  started: { label: "FMS started", tone: "border-success/40 text-success" },
  not_matched: { label: "Not matched", tone: "border-gold/20 text-soft-grey" },
  duplicate: { label: "Duplicate (run already open)", tone: "border-champagne/30 text-champagne" },
  out_of_scope: { label: "Other branch", tone: "border-gold/20 text-soft-grey" },
  review: { label: "Requires review", tone: "border-danger/40 text-danger" },
  failed: { label: "Failed", tone: "border-danger/40 text-danger" },
  no_workflow: { label: "No workflow evaluated", tone: "border-gold/20 text-soft-grey" },
};
const FILTERS: ReadonlyArray<Readonly<{ value: string; label: string }>> = [
  { value: "", label: "All events" }, { value: "attention", label: "Needs attention" }, { value: "started", label: "FMS started" },
  { value: "not_matched", label: "Not matched" }, { value: "duplicate", label: "Duplicates" }, { value: "failed", label: "Failed" }, { value: "review", label: "Requires review" },
];

/**
 * Trigger history (0374), for FMS managers: every saved submission a published automatic workflow
 * evaluated, and what happened. No answers are shown in the list; Inspect shows them only when
 * the viewer may see that source (CRM answers need CRM access).
 */
export function FmsTriggerHistory({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState("");
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<FmsTriggerEventDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setError(null);
    try { setHistory(await loadFmsTriggerHistory(filter ? { outcome: filter } : {})); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load trigger history"); }
  }, [filter]);
  useEffect(() => { void refresh(); }, [refresh]);
  const inspect = async (eventId: string) => { setBusy(eventId); setError(null); try { setDetail(await inspectFmsTriggerEvent(eventId)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not open the event"); } finally { setBusy(null); } };
  const retry = async (eventId: string) => { setBusy(eventId); setError(null); try { await retryFmsTriggerEvent(eventId); setDetail(null); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Retry failed"); } finally { setBusy(null); } };
  const summary = history?.summary;
  return <Modal mobileFullscreen onClose={onClose} title="Trigger history" wide>
    <div className="space-y-4" data-testid="fms-trigger-history">
      {summary ? <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        {([["Events (7 days)", summary.events7d], ["Started", summary.started7d], ["Not matched", summary.notMatched7d], ["Duplicates", summary.duplicates7d], ["Needs attention", summary.needsAttention]] as const).map(([label, value]) =>
          <div className={`rounded-xl border p-2 ${label === "Needs attention" && value ? "border-danger/40" : "border-gold/20"}`} key={label}><dt className="text-soft-grey">{label}</dt><dd className="text-lg font-semibold tabular-nums text-white">{value}</dd></div>)}
      </dl> : null}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Filter trigger history" className="field w-auto" onChange={(event) => setFilter(event.target.value)} value={filter}>{FILTERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        <Button onClick={() => void refresh()} variant="ghost"><RefreshCw className="size-4" />Refresh</Button>
        {summary?.lastEventAt ? <span className="text-xs text-soft-grey">Last event {new Date(summary.lastEventAt).toLocaleString()}</span> : null}
      </div>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!history ? <div className="h-32 animate-pulse rounded-2xl bg-charcoal" /> : history.rows.length === 0 ? <Notice>No trigger events yet. Events appear after an automatic workflow is published and a matching source is saved.</Notice>
        : <ul className="space-y-2">{history.rows.map((row, index) => {
          const outcome = OUTCOMES[row.outcome] ?? OUTCOMES.failed;
          return <li className="flex flex-wrap items-center gap-2 rounded-xl border border-gold/15 p-3 text-sm" key={`${row.eventId}-${row.flowName ?? ""}-${index}`}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">{fmsTriggerSource(row.sourceType)?.label ?? row.sourceType}{row.flowName ? <span className="font-normal text-soft-grey"> → {row.flowName} v{row.flowVersion}</span> : null}</p>
              <p className="text-xs text-soft-grey">{new Date(row.receivedAt).toLocaleString()}{row.attempts > 1 ? ` · ${row.attempts} attempts` : ""}{row.referenceNumber ? ` · ${row.referenceNumber}` : ""}{row.detail ? ` · ${row.detail}` : ""}</p>
            </div>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${outcome.tone}`}>{outcome.label}</span>
            <Button aria-label="Inspect event" disabled={busy === row.eventId} onClick={() => void inspect(row.eventId)} variant="ghost"><Search className="size-4" />Inspect</Button>
            {row.outcome === "review" || row.outcome === "failed" || row.eventStatus === "failed" || row.eventStatus === "review" ? <Button disabled={busy === row.eventId} onClick={() => void retry(row.eventId)} variant="secondary"><RefreshCw className="size-4" />Retry</Button> : null}
          </li>;
        })}</ul>}
      {detail ? <section className="space-y-3 rounded-2xl border border-gold/30 p-4" data-testid="fms-trigger-event">
        <div className="flex flex-wrap items-center gap-2"><h4 className="mr-auto font-semibold text-white">{fmsTriggerSource(detail.sourceType)?.label ?? detail.sourceType}</h4><span className="text-xs text-soft-grey">{detail.status} · {detail.attempts} attempt{detail.attempts === 1 ? "" : "s"}</span><Button onClick={() => setDetail(null)} variant="ghost">Close</Button></div>
        {detail.lastError ? <Notice tone="danger">{detail.lastError}</Notice> : null}
        {detail.evaluations.map((evaluation, index) => <div className="space-y-1 rounded-xl border border-gold/15 p-3 text-xs" key={`${evaluation.flowName}-${index}`}>
          <p className="font-semibold text-white">{evaluation.flowName} v{evaluation.flowVersion}: {(OUTCOMES[evaluation.outcome] ?? OUTCOMES.failed).label}</p>
          {evaluation.detail ? <p className="text-soft-grey">{evaluation.detail}</p> : null}
          <ul>{evaluation.rules.map((rule) => <li className={rule.skipped ? "text-soft-grey" : rule.passed ? "text-success" : "text-danger"} key={rule.id}>{rule.skipped ? "Off" : rule.passed ? "Passed" : "Failed"}: {rule.field} {rule.operator.replaceAll("_", " ")}</li>)}</ul>
          {evaluation.instanceId ? <a className="inline-flex min-h-11 items-center font-semibold text-gold-secondary underline" href={fmsAssignedWorkPath({ kind: "stage", instanceId: evaluation.instanceId, instanceStageId: null })}>Open run {evaluation.referenceNumber}</a> : null}
        </div>)}
        {detail.answers ? <details><summary className="cursor-pointer text-xs text-soft-grey">Saved answers</summary><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">{Object.entries(detail.answers).map(([key, value]) => [<dt className="text-soft-grey" key={`${key}-k`}>{key}</dt>, <dd className="break-words text-white" key={`${key}-v`}>{Array.isArray(value) ? value.join(", ") : String(value ?? "")}</dd>])}</dl></details> : <p className="text-xs text-soft-grey">Answers are shown only to people with access to this source.</p>}
        {detail.crmClientId ? <a className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-secondary underline" href={`/crm/clients/${encodeURIComponent(detail.crmClientId)}`}>Open CRM client profile</a> : null}
      </section> : null}
    </div>
  </Modal>;
}
