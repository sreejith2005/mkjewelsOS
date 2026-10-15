import { useEffect, useState } from "react";
import type { FmsHandoffChoice, FmsTransitionRequest, FmsWorkPreview } from "@jewelos/core";
import { listFmsHandoffRecipients, type FmsHandoffRecipient } from "@jewelos/data/fms/work";
import { Button, Field, Modal, Notice } from "@/components/ui";

export function FmsHandoffConfirmation({ request, preview, onConfirm, onCancel }: {
  request: FmsTransitionRequest; preview: FmsWorkPreview;
  onConfirm: (choices: readonly FmsHandoffChoice[]) => void; onCancel: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<readonly FmsHandoffRecipient[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!picking) return;
    let active = true;
    setLoading(true); setError(null); setPeople([]); setCursor(null);
    const timer = window.setTimeout(() => {
      void listFmsHandoffRecipients(request, picking, query).then(result => {
        if (active) { setPeople(result.people); setCursor(result.nextCursor); }
      }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to load eligible employees"); })
        .finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [picking, query, request]);
  const loadMore = async () => {
    if (!cursor || !picking || loading) return;
    setLoading(true); setError(null);
    try {
      const result = await listFmsHandoffRecipients(request, picking, query, cursor);
      setPeople(current => [...current, ...result.people]); setCursor(result.nextCursor);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load more employees"); }
    finally { setLoading(false); }
  };
  const needsChoice = preview.destinations.some(destination => !choices[destination.targetStageId] && (destination.issue || !destination.effectiveUserId));
  const replacements = preview.destinations.flatMap(destination => choices[destination.targetStageId]
    ? [{ targetStageId: destination.targetStageId, userProfileId: choices[destination.targetStageId]! }] : []);
  return <Modal onClose={onCancel} title={preview.destinations.length ? "Complete Stage and Assign Next Work" : "Confirm Stage Completion"} wide>
    <div className="space-y-4">
      <p className="text-sm text-soft-grey">Current Stage: <strong className="text-white">{preview.currentStageName}</strong></p>
      {preview.wouldDefer ? <Notice>Your form and handoff will be saved. Next work starts after the remaining requirements are met.<ul className="mt-2 list-disc pl-5">{preview.requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul></Notice> : null}
      {preview.destinations.map(destination => <article className="space-y-2 rounded-xl border border-gold/20 p-3" key={destination.targetStageId}>
        <p className="font-semibold text-white">Next Stage: {destination.stageName}</p>
        <p className="text-sm text-soft-grey">Selected Employee: {choices[destination.targetStageId]
          ? people.find(person => person.id === choices[destination.targetStageId])?.employeeName ?? "Selected replacement" : destination.employeeName ?? "Select an employee"}</p>
        {destination.locked ? <Notice>Fixed employee — locked by the workflow administrator. The form's employee choice does not replace this owner.</Notice> : null}
        {destination.issue ? <Notice tone="danger">{destination.issue}</Notice> : null}
        {destination.allowHandoff && !destination.locked ? <Button onClick={() => { setPicking(destination.targetStageId); setQuery(""); }} variant="secondary">{preview.destinations.length > 1 ? `Assign a Different Employee for ${destination.stageName}` : "Assign to a Different Employee"}</Button> : null}
      </article>)}
      {picking ? <section aria-label="Eligible employee picker" className="space-y-3 rounded-xl border border-gold/20 p-3">
        <Field label="Search eligible employees"><input className="field" value={query} onChange={event => setQuery(event.target.value)} /></Field>
        {loading ? <p role="status" className="text-sm text-soft-grey">Loading eligible employees...</p> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="max-h-64 space-y-2 overflow-y-auto">{people.map(person => <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-gold/15 p-3" key={person.id}>
          <input type="radio" name={`handoff-${picking}`} checked={choices[picking] === person.id} onChange={() => setChoices(current => ({ ...current, [picking]: person.id }))} />
          <span><strong className="block text-sm text-white">{person.employeeName}</strong><span className="text-xs text-soft-grey">{[person.designation, person.department, person.branch].filter(Boolean).join(" · ")}</span></span>
        </label>)}</div>
        {!loading && !people.length && !error ? <p className="text-sm text-soft-grey">No eligible employees match this search.</p> : null}
        {cursor ? <Button variant="secondary" disabled={loading} onClick={() => void loadMore()}>Load more employees</Button> : null}
      </section> : null}
      {!preview.destinations.length ? <p className="text-sm text-soft-grey">Confirm this step's completion. The workflow finishes after all required work and approvals are complete.</p> : <p className="text-sm text-soft-grey">How would you like to continue?</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!!needsChoice} onClick={() => onConfirm(replacements)}>{!preview.destinations.length ? "Confirm Completion" : replacements.length ? "Confirm Next Work" : "Continue with Selected Employee"}</Button>
        <Button onClick={onCancel} variant="ghost">Cancel and Return to Form</Button>
      </div>
    </div>
  </Modal>;
}
