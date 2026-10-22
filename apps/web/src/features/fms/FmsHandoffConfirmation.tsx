import { useEffect, useMemo, useRef, useState } from "react";
import type { FmsHandoffDecision, FmsTransitionRequest, FmsWorkPreview } from "@jewelos/core";
import { listFmsHandoffRecipients, previewFmsWork, type FmsHandoffRecipient } from "@jewelos/data/fms/work";
import { UserRound } from "lucide-react";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { FmsWorkSteps } from "./FmsWorkSteps";

export function FmsHandoffConfirmation({ request, preview, onConfirm, onCancel }: {
  request: FmsTransitionRequest; preview: FmsWorkPreview;
  onConfirm: (decision: FmsHandoffDecision) => void; onCancel: () => void;
}) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<readonly FmsHandoffRecipient[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPreview, setCurrentPreview] = useState(preview);
  const [checkedChoices, setCheckedChoices] = useState("[]");
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const replacements = useMemo(() => preview.destinations.flatMap(destination => choices[destination.targetStageId]
    ? [{ targetStageId: destination.targetStageId, userProfileId: choices[destination.targetStageId]! }] : []), [preview.destinations, choices]);
  const choiceKey = JSON.stringify(replacements);
  useEffect(() => {
    if (choiceKey === "[]") { setCurrentPreview(preview); setCheckedChoices(choiceKey); setChoiceError(null); return; }
    let active = true; setChoiceError(null);
    void previewFmsWork(request, replacements).then(value => { if (active) { setCurrentPreview(value); setCheckedChoices(choiceKey); } })
      .catch((error: unknown) => { if (active) setChoiceError(error instanceof Error ? error.message : "Unable to check this handoff"); });
    return () => { active = false; };
    // The serialized key includes every destination and selected employee.
  }, [request, preview, choiceKey, replacements]);
  useEffect(() => {
    if (!picking) return;
    let active = true;
    ++generation.current;
    setLoading(true); setError(null); setPeople([]); setCursor(null);
    const timer = window.setTimeout(() => {
      void listFmsHandoffRecipients(request, picking, query).then(result => {
        if (active) { setPeople(result.people); setCursor(result.nextCursor); }
      }).catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "Unable to load eligible employees"); })
        .finally(() => { if (active) setLoading(false); });
    }, 150);
    return () => { active = false; ++generation.current; window.clearTimeout(timer); };
  }, [picking, query, request]);
  const loadMore = async () => {
    if (!cursor || !picking || loading) return;
    const version = generation.current;
    setLoading(true); setError(null);
    try {
      const result = await listFmsHandoffRecipients(request, picking, query, cursor);
      if (version === generation.current) { setPeople(current => [...current, ...result.people]); setCursor(result.nextCursor); }
    } catch (caught) { if (version === generation.current) setError(caught instanceof Error ? caught.message : "Unable to load more employees"); }
    finally { if (version === generation.current) setLoading(false); }
  };
  const needsChoice = currentPreview.destinations.some(destination => !choices[destination.targetStageId] && (destination.issue || !destination.effectiveUserId));
  return <Modal onClose={onCancel} title={preview.destinations.length ? "Complete Stage and Assign Next Work" : "Confirm Stage Completion"} wide>
    <div className="space-y-4">
      <FmsWorkSteps current={3} />
      <p className="text-sm text-task-text-muted">You are completing: <strong className="text-task-text">{preview.currentStageName}</strong></p>
      {preview.destinations.length ? <p className="text-sm text-task-text">Check who will do the next step. Choose someone else only if this person should not receive it.</p> : null}
      {currentPreview.wouldDefer ? <Notice>Your form and handoff will be saved. Next work starts after the remaining requirements are met.<ul className="mt-2 list-disc pl-5">{currentPreview.requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul></Notice> : null}
      {currentPreview.destinations.map(destination => {
        const chosen = choices[destination.targetStageId] ? names[destination.targetStageId] ?? destination.selectedEmployeeName ?? "Selected replacement" : destination.selectedEmployeeName ?? destination.employeeName ?? null;
        return <article className="space-y-3 rounded-xl border border-task-border bg-task-bg p-3" key={destination.targetStageId}>
          <div><p className="text-xs font-semibold uppercase tracking-wider text-task-text-muted">Next step</p><p className="break-words font-semibold text-task-text">{destination.stageName}</p></div>
          <div className="flex items-center gap-3 rounded-lg bg-task-muted p-3"><UserRound aria-hidden="true" className="size-5 shrink-0 text-gold-secondary" /><div className="min-w-0"><p className="text-xs text-task-text-muted">Will be assigned to</p><p className={chosen ? "break-words font-semibold text-task-text" : "font-semibold text-danger"}>{chosen ?? "Nobody yet — choose an employee"}</p></div></div>
          {destination.selectedUserId && destination.effectiveUserId && destination.selectedUserId !== destination.effectiveUserId ? <Notice>Assigned employee through availability coverage: {destination.employeeName}<span className="mt-1 block text-xs">The chosen employee is unavailable, so the person covering for them receives this step.</span></Notice> : null}
          {destination.locked ? <Notice>Fixed employee — locked by the workflow administrator. The form's employee choice does not replace this owner.</Notice> : null}
          {destination.issue ? <Notice tone="danger">{destination.issue}</Notice> : null}
          {destination.allowHandoff && !destination.locked ? <Button className="w-full sm:w-auto" onClick={() => { setPicking(destination.targetStageId); setQuery(""); }} variant="secondary">{preview.destinations.length > 1 ? `Assign a Different Employee for ${destination.stageName}` : "Assign to a Different Employee"}</Button> : null}
        </article>;
      })}
      {picking ? <section aria-label="Eligible employee picker" className="space-y-3 rounded-xl border border-gold/20 p-3">
        <Field label="Search eligible employees"><input className="field" value={query} onChange={event => setQuery(event.target.value)} /></Field>
        {loading ? <p role="status" className="text-sm text-soft-grey">Loading eligible employees...</p> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="max-h-64 space-y-2 overflow-y-auto">{people.map(person => <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-gold/15 p-3" key={person.id}>
          <input type="radio" name={`handoff-${picking}`} checked={choices[picking] === person.id} onChange={() => { setChoices(current => ({ ...current, [picking]: person.id })); setNames(current => ({ ...current, [picking]: person.employeeName })); }} />
          <span><strong className="block text-sm text-white">{person.employeeName}</strong><span className="text-xs text-soft-grey">{[person.designation, person.department, person.branch].filter(Boolean).join(" · ")}</span></span>
        </label>)}</div>
        {!loading && !people.length && !error ? <p className="text-sm text-soft-grey">No eligible employees match this search.</p> : null}
        {cursor ? <Button variant="secondary" disabled={loading} onClick={() => void loadMore()}>Load more employees</Button> : null}
      </section> : null}
      {checkedChoices !== choiceKey && !choiceError ? <p className="text-sm text-soft-grey" role="status">Checking the selected employee and availability coverage…</p> : null}
      {choiceError ? <Notice tone="danger">{choiceError}</Notice> : null}
      {!preview.destinations.length ? <p className="text-sm text-task-text-muted">Confirm this step's completion. The workflow finishes after all required work and approvals are complete.</p> : null}
      {needsChoice ? <p className="text-sm font-medium text-danger">Choose an employee for every next step before you confirm.</p> : null}
      <div className="sticky bottom-0 -mx-5 flex flex-col gap-2 border-t border-task-border bg-charcoal px-5 py-3 sm:static sm:mx-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
        <Button className="min-h-12" disabled={!!needsChoice || checkedChoices !== choiceKey || !!choiceError} onClick={() => onConfirm({ handoffs: replacements, preview: currentPreview })}>{!preview.destinations.length ? "Confirm Completion" : replacements.length ? "Confirm Next Work" : "Continue with Selected Employee"}</Button>
        <Button className="min-h-12" onClick={onCancel} variant="ghost">Cancel and Return to Form</Button>
      </div>
    </div>
  </Modal>;
}
