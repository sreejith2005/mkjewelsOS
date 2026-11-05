import { useEffect, useRef, useState, type ComponentProps } from "react";
import { toast } from "sonner";
import { beginNewLibrarySubmission, beginNewFmsStartingFlow, fmsStartConfirmationFromWork, listFmsFormStarters, recoverFmsStartingFlow, recoverFmsStartingWork, recoverLibrarySubmission, type FmsStartConfirmation } from "@jewelos/data/fms/work";
import { Notice } from "@/components/ui";
import { sentToLine } from "@/features/fms/FmsWorkOutcome";
import { submitStandaloneFormAndStartFms } from "./api";
import { FormRenderer } from "./FormRenderer";
import { useFmsHandoffConfirmation } from "@/features/fms/useFmsHandoffConfirmation";

export function FmsStartingForm({ formId, starterAssignmentId, onSaved, ...renderer }: Omit<ComponentProps<typeof FormRenderer>, "onSubmit"> & {
  formId: string; starterAssignmentId?: string; onSaved: () => Promise<void>;
}) {
  const [flows, setFlows] = useState<Awaited<ReturnType<typeof listFmsFormStarters>> | null>(null);
  const [flowId, setFlowId] = useState("");
  const [started, setStarted] = useState<FmsStartConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirmWork, confirmation } = useFmsHandoffConfirmation(formId);
  const selectedFlow = flows?.find(flow => flow.flowId === flowId) ?? (flows?.length === 1 ? flows[0] : undefined);
  useEffect(() => {
    if (!starterAssignmentId) return;
    let alive = true;
    void recoverFmsStartingWork(starterAssignmentId).then(result => { if (alive && result) setStarted(result); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Could not recover this submission"); });
    return () => { alive = false; };
  }, [starterAssignmentId]);
  useEffect(() => {
    if (starterAssignmentId) return;
    let alive = true;
    void listFmsFormStarters(formId).then(rows => { if (alive) setFlows(rows); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Could not load workflow choices"); });
    return () => { alive = false; };
  }, [formId, starterAssignmentId]);
  useEffect(() => {
    if (starterAssignmentId || flows === null || flows.length > 1 && !flowId) return;
    let alive = true;
    const recovery = selectedFlow ? recoverFmsStartingFlow(selectedFlow.flowId) : recoverLibrarySubmission(formId);
    void recovery.then(result => { if (alive && result) setStarted(result); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Could not recover submission"); });
    return () => { alive = false; };
  }, [formId, starterAssignmentId, flows, flowId]);
  // Recovery and normal submission share the same quiet completion path. A new
  // library fill gets a new retry identity only after this save is confirmed.
  const finish = useRef(onSaved);
  finish.current = onSaved;
  useEffect(() => {
    if (!started) return;
    let alive = true;
    void (async () => {
      if (!starterAssignmentId) await (selectedFlow ? beginNewFmsStartingFlow(selectedFlow.flowId) : beginNewLibrarySubmission(formId));
      if (!alive) return;
      toast.success(["Form submitted.", sentToLine(started.assignmentSummary)].filter(Boolean).join(" "));
      await finish.current();
    })().catch((caught: unknown) => { if (alive) setError(caught instanceof Error ? caught.message : "Could not finish submission"); });
    return () => { alive = false; };
  }, [started, formId, starterAssignmentId, selectedFlow?.flowId]);
  if (started) return error ? <Notice tone="danger">{error}</Notice> : null;
  return <>
    {renderer.definition.description ? <p className="mb-4 px-1 text-sm text-soft-grey">{renderer.definition.description}</p> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {!starterAssignmentId && flows === null ? <Notice>Loading…</Notice> : null}
    {flows && flows.length > 1 ? <label className="mb-4 block text-sm text-champagne">Workflow to start<select aria-label="Workflow to start" className="field mt-1" onChange={event => setFlowId(event.target.value)} value={flowId}><option value="">Choose a workflow</option>{flows.map(flow => <option key={flow.flowId} value={flow.flowId}>{flow.name}</option>)}</select></label> : null}
    <FormRenderer {...renderer} onSubmit={async answers => {
      if (!starterAssignmentId && (flows === null || flows.length > 1 && !flowId)) throw new Error("Choose the workflow before submitting this form.");
      if (starterAssignmentId || selectedFlow) {
        const completed = await confirmWork(starterAssignmentId ? { kind: "starter_form", starterAssignmentId, formTemplateId: formId, answers }
          : { kind: "flow_form", flowId: selectedFlow!.flowId, formTemplateId: formId, answers });
        if (!completed) return false;
        setStarted(fmsStartConfirmationFromWork(completed, selectedFlow?.name));
      } else setStarted(await submitStandaloneFormAndStartFms(formId, answers));
      return true;
    }} />
    {confirmation}
  </>;
}
