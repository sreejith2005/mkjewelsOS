import { useEffect, useState, type ComponentProps } from "react";
import { fmsAssignedWorkPath } from "@jewelos/core";
import { beginNewLibrarySubmission, beginNewFmsStartingFlow, fmsStartConfirmationFromWork, listFmsFormStarters, recoverFmsStartingFlow, recoverFmsStartingWork, recoverLibrarySubmission, type FmsStartConfirmation } from "@jewelos/data/fms/work";
import { Button, Notice } from "@/components/ui";
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
  const [generation, setGeneration] = useState(0);
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
  if (started) return <div className="space-y-4">
    <Notice tone="success">Form submitted successfully. {started.workflowName ? `${started.workflowName} has started.` : started.instanceId ? "The workflow has started." : "Your answers have been saved."} {started.referenceNumber}</Notice>
    {started.assignmentSummary?.map((item, index) => <p className="text-sm text-champagne" key={index}>{item.stageName}: {item.employeeName}</p>)}
    {started.ownWorkTargets?.[0] ? <a className="text-gold underline" href={fmsAssignedWorkPath(started.ownWorkTargets[0])}>Open my next work</a> : null}
    {!starterAssignmentId ? <Button onClick={() => { void (selectedFlow ? beginNewFmsStartingFlow(selectedFlow.flowId) : beginNewLibrarySubmission(formId)).then(() => { setStarted(null); setGeneration(n => n + 1); }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not start another submission")); }} variant="secondary">Start another submission</Button> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
  </div>;
  return <>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {!starterAssignmentId && flows === null ? <Notice>Loading available workflows…</Notice> : null}
    {flows && flows.length > 1 ? <label className="mb-4 block text-sm text-champagne">Workflow to start<select aria-label="Workflow to start" className="field mt-1" onChange={event => setFlowId(event.target.value)} value={flowId}><option value="">Choose a workflow</option>{flows.map(flow => <option key={flow.flowId} value={flow.flowId}>{flow.name} (v{flow.version})</option>)}</select></label> : null}
    <FormRenderer {...renderer} key={generation} onSubmit={async answers => {
      if (!starterAssignmentId && (flows === null || flows.length > 1 && !flowId)) throw new Error("Choose the workflow before submitting this form.");
      if (starterAssignmentId || selectedFlow) {
        const completed = await confirmWork(starterAssignmentId ? { kind: "starter_form", starterAssignmentId, formTemplateId: formId, answers }
          : { kind: "flow_form", flowId: selectedFlow!.flowId, formTemplateId: formId, answers });
        if (!completed) return false;
        setStarted(fmsStartConfirmationFromWork(completed, selectedFlow?.name));
      } else setStarted(await submitStandaloneFormAndStartFms(formId, answers));
      await onSaved(); return true;
    }} />
    {confirmation}
  </>;
}
