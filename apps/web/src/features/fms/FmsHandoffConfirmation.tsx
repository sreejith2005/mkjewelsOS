import { useEffect, useMemo, useRef, useState } from "react";
import type { FmsHandoffDecision, FmsTransitionRequest, FmsWorkPreview } from "@jewelos/core";
import { listFmsHandoffRecipients, previewFmsWork, type FmsHandoffRecipient } from "@jewelos/data/fms/work";
import { Check, UserRound } from "lucide-react";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FmsWorkSteps } from "./FmsWorkSteps";

/** The employee finishing the work. A next step nobody owns stays with them by default. */
export type FmsHandoffActor = Readonly<{ id: string; name: string }>;

/**
 * Next steps the server could not give an owner (no employee question in the form,
 * or the owner is unavailable) default to the actor. This is only a proposal: it is
 * sent as an explicit handoff, so the server checks it on preview and again on commit.
 */
export function defaultFmsHandoffChoices(preview: FmsWorkPreview, actor: FmsHandoffActor | null | undefined): Record<string, string> {
  if (!actor) return {};
  return Object.fromEntries(preview.destinations
    .filter(destination => destination.allowHandoff && !destination.locked && (destination.issue || !destination.effectiveUserId))
    .map(destination => [destination.targetStageId, actor.id]));
}

export function FmsHandoffConfirmation({ request, preview, actor, onConfirm, onCancel }: {
  request: FmsTransitionRequest; preview: FmsWorkPreview; actor?: FmsHandoffActor | null;
  onConfirm: (decision: FmsHandoffDecision) => void; onCancel: () => void;
}) {
  const [defaults] = useState(() => defaultFmsHandoffChoices(preview, actor));
  const [choices, setChoices] = useState<Record<string, string>>(defaults);
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(Object.keys(defaults).map(id => [id, actor?.name ?? ""])));
  const generation = useRef(0);
  const [picking, setPicking] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
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
  // The picker opens inside its step's card; bring it into view on a phone.
  useEffect(() => { if (picking) pickerRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }, [picking]);
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
  const choose = (stageId: string, id: string, name: string) => {
    setChoices(current => ({ ...current, [stageId]: id })); setNames(current => ({ ...current, [stageId]: name })); setPicking(null);
  };
  const needsChoice = currentPreview.destinations.some(destination => !choices[destination.targetStageId] && (destination.issue || !destination.effectiveUserId));
  const checking = checkedChoices !== choiceKey && !choiceError;
  const many = preview.destinations.length > 1;
  return <Modal mobileFullscreen onClose={onCancel} title={preview.destinations.length ? "Complete Stage and Assign Next Work" : "Confirm Stage Completion"} wide>
    <div className="space-y-4">
      <FmsWorkSteps current={3} />
      <p className="text-sm text-task-text-muted">You are completing: <strong className="text-task-text">{preview.currentStageName}</strong></p>
      {currentPreview.wouldDefer ? <Notice>Your form and handoff will be saved. Next work starts after the remaining requirements are met.<ul className="mt-2 list-disc pl-5">{currentPreview.requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul></Notice> : null}
      {currentPreview.destinations.map(destination => {
        const stageId = destination.targetStageId;
        const choiceId = choices[stageId];
        const chosen = choiceId ? names[stageId] || destination.selectedEmployeeName || "Selected replacement" : destination.selectedEmployeeName ?? destination.employeeName ?? null;
        const isActor = !!actor && (choiceId ?? destination.selectedUserId ?? destination.effectiveUserId) === actor.id;
        const keptWithActor = isActor && defaults[stageId] === actor?.id && choiceId === actor?.id;
        const canChange = destination.allowHandoff && !destination.locked;
        const open = picking === stageId;
        return <article className="space-y-3 rounded-2xl border border-task-border bg-task-bg p-4" key={stageId}>
          <div><p className="text-xs font-semibold uppercase tracking-wider text-task-text-muted">Next step</p><p className="break-words text-lg font-semibold text-task-text">{destination.stageName}</p></div>
          <div className="flex items-center gap-3 rounded-xl bg-task-muted p-3">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gold/15"><UserRound className="size-5 text-gold-secondary" /></span>
            <div className="min-w-0">
              <p className="text-xs text-task-text-muted">Will be assigned to</p>
              <p className={chosen ? "break-words font-semibold text-task-text" : "font-semibold text-danger"}>{chosen ? `${chosen}${isActor ? " (you)" : ""}` : "Nobody yet — choose an employee"}</p>
              {keptWithActor ? <p className="mt-0.5 text-xs text-task-text-muted">No employee was set for this step, so it stays with you.</p> : null}
            </div>
          </div>
          {destination.selectedUserId && destination.effectiveUserId && destination.selectedUserId !== destination.effectiveUserId ? <Notice>Assigned employee through availability coverage: {destination.employeeName}<span className="mt-1 block text-xs">The chosen employee is unavailable, so the person covering for them receives this step.</span></Notice> : null}
          {destination.locked ? <Notice>Fixed employee — locked by the workflow administrator. The form's employee choice does not replace this owner.</Notice> : null}
          {destination.issue && !choiceId ? <Notice tone="danger">{destination.issue}</Notice> : null}
          {canChange && !open ? <div className="space-y-2 border-t border-task-border pt-3">
            <p className="text-sm text-task-text">Should someone else do this step?</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="min-h-12 w-full sm:w-auto" onClick={() => { setPicking(stageId); setQuery(""); }} variant="secondary">{many ? `Assign a Different Employee for ${destination.stageName}` : "Assign to a Different Employee"}</Button>
              {actor && defaults[stageId] === actor.id && choiceId !== actor.id ? <Button className="min-h-12 w-full sm:w-auto" onClick={() => choose(stageId, actor.id, actor.name)} variant="ghost">Keep it with me</Button> : null}
            </div>
          </div> : null}
          {open ? <div aria-label="Eligible employee picker" className="scroll-mt-20 space-y-3 border-t border-task-border pt-3" ref={pickerRef} role="group">
            <Field label="Search eligible employees"><input className="field" enterKeyHint="search" placeholder="Type a name" type="search" value={query} onChange={event => setQuery(event.target.value)} /></Field>
            {loading ? <p role="status" className="text-sm text-task-text-muted">Loading eligible employees...</p> : null}
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <div className="max-h-[50dvh] space-y-2 overflow-y-auto overscroll-contain">{people.map(person => {
              const selected = choiceId === person.id;
              return <label className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold", selected ? "border-gold bg-gold/10" : "border-task-border hover:border-gold/50")} key={person.id}>
                <input className="sr-only" type="radio" name={`handoff-${stageId}`} checked={selected} onChange={() => choose(stageId, person.id, person.employeeName)} />
                <span className="min-w-0 flex-1"><strong className="block break-words text-sm text-task-text">{person.employeeName}{actor?.id === person.id ? " (you)" : ""}</strong><span className="break-words text-xs text-task-text-muted">{[person.designation, person.department, person.branch].filter(Boolean).join(" · ")}</span></span>
                {selected ? <Check aria-hidden="true" className="size-5 shrink-0 text-gold-secondary" /> : null}
              </label>;
            })}</div>
            {!loading && !people.length && !error ? <p className="text-sm text-task-text-muted">No eligible employees match this search.</p> : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              {cursor ? <Button className="min-h-12" variant="secondary" disabled={loading} onClick={() => void loadMore()}>Load more employees</Button> : null}
              <Button className="min-h-12" onClick={() => setPicking(null)} variant="ghost">Close list</Button>
            </div>
          </div> : null}
        </article>;
      })}
      {checking ? <p className="text-sm text-task-text-muted" role="status">Checking the selected employee and availability coverage…</p> : null}
      {choiceError ? <Notice tone="danger">{choiceError}</Notice> : null}
      {!preview.destinations.length ? <p className="text-sm text-task-text-muted">Confirm this step's completion. The workflow finishes after all required work and approvals are complete.</p> : null}
      {needsChoice ? <p className="text-sm font-medium text-danger">Choose an employee for every next step before you confirm.</p> : null}
      {/* Pinned to the sheet's real bottom edge on phones, through the sheet's own padding. */}
      <div className="sticky bottom-[calc(-1*max(1.25rem,env(safe-area-inset-bottom)))] z-10 -mx-5 flex flex-col gap-2 border-t border-task-border bg-charcoal px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
        <Button className="min-h-12" disabled={!!needsChoice || checkedChoices !== choiceKey || !!choiceError} onClick={() => onConfirm({ handoffs: replacements, preview: currentPreview })}>{!preview.destinations.length ? "Confirm Completion" : replacements.length ? "Confirm Next Work" : "Continue with Selected Employee"}</Button>
        <Button className="min-h-12" onClick={onCancel} variant="ghost">Cancel and Return to Form</Button>
      </div>
    </div>
  </Modal>;
}
