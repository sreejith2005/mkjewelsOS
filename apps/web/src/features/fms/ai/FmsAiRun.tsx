import { useState } from "react";
import { analyseFmsRun, type FmsRunObservation, type FmsRunSnapshot } from "@jewelos/core";
import { Field, Notice } from "@/components/ui";
import { loadFmsRunSnapshot } from "./api";

export type FmsAiRunCandidate = Readonly<{ id: string; label: string }>;

const BASIS = { observed: "Observed in the records", indeterminate: "Not enough evidence" } as const;

/**
 * "Diagnose run": the observations come from the stored records through the
 * bounded snapshot RPC and need no model. Sending them to the assistant is a
 * separate, explicit choice (`consent`).
 */
export function FmsAiRunPicker({ candidates, onLoaded, consent, onConsent }: {
  candidates: readonly FmsAiRunCandidate[]; onLoaded: (snapshot: FmsRunSnapshot | null) => void; consent: boolean; onConsent: (value: boolean) => void;
}) {
  const [instanceId, setInstanceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [observations, setObservations] = useState<readonly FmsRunObservation[] | null>(null);
  const [snapshot, setSnapshot] = useState<FmsRunSnapshot | null>(null);
  const load = async (id: string) => {
    setInstanceId(id); setError(null); setObservations(null); setSnapshot(null); onLoaded(null); onConsent(false);
    if (!id) return;
    setBusy(true);
    try {
      const value = await loadFmsRunSnapshot(id);
      setSnapshot(value); setObservations(analyseFmsRun(value, new Date())); onLoaded(value);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load the run."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Diagnose run" className="space-y-3">
    {candidates.length ? <Field label="Run to diagnose"><select className="field" disabled={busy} onChange={(event) => void load(event.target.value)} value={instanceId}><option value="">Choose a run</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select></Field>
      : <Notice>No runs of this workflow are visible to you yet.</Notice>}
    {busy ? <p className="text-xs text-soft-grey" role="status">Loading the run records…</p> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {snapshot && observations ? <>
      <p className="text-xs text-soft-grey">{snapshot.instance.referenceNumber} · {snapshot.flow.name} v{snapshot.flow.version} · {snapshot.instance.status.replaceAll("_", " ")}. Hidden for privacy: {snapshot.redacted.join(", ")}.</p>
      <ul aria-label="Run observations" className="space-y-2">{observations.map((item) => <li className={`rounded-xl border p-3 text-sm ${item.severity === "error" ? "border-danger/40 bg-danger/5" : item.severity === "warning" ? "border-gold/40 bg-gold/5" : "border-gold/15"}`} key={item.id}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-champagne">{BASIS[item.basis]}</p>
        <p className="font-semibold text-white">{item.title}</p>
        <ul className="mt-1 list-disc pl-4 text-xs text-soft-grey">{item.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul>
      </li>)}</ul>
      <label className="flex items-start gap-2 rounded-xl border border-gold/20 p-3 text-xs text-champagne"><input checked={consent} className="mt-0.5 size-4 accent-gold" onChange={(event) => onConsent(event.target.checked)} type="checkbox" />
        <span>Include this run's records in my question to the AI assistant: step statuses, assignee names and status, routing answers and failed-attempt codes. Remarks, other answers, files and contact details are never sent.</span></label>
    </> : null}
  </section>;
}
