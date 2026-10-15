import { useEffect, useState, type ComponentProps } from "react";
import { fmsAssignedWorkPath } from "@jewelos/core";
import { beginNewLibrarySubmission, listFmsFormStarters, recoverLibrarySubmission, type FmsStartConfirmation } from "@jewelos/data/fms/work";
import { Button, Notice } from "@/components/ui";
import { submitFmsStarterAssignment, submitStandaloneFormAndStartFms } from "./api";
import { FormRenderer } from "./FormRenderer";

export function FmsStartingForm({ formId, starterAssignmentId, onSaved, ...renderer }: Omit<ComponentProps<typeof FormRenderer>, "onSubmit"> & {
  formId: string; starterAssignmentId?: string; onSaved: () => Promise<void>;
}) {
  const [flows, setFlows] = useState<Awaited<ReturnType<typeof listFmsFormStarters>> | null>(null);
  const [flowId, setFlowId] = useState("");
  const [started, setStarted] = useState<FmsStartConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (starterAssignmentId) return;
    let alive = true;
    void listFmsFormStarters(formId).then(rows => { if (alive) setFlows(rows); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Could not load workflow choices"); });
    return () => { alive = false; };
  }, [formId, starterAssignmentId]);
  useEffect(() => {
    if (starterAssignmentId || flows === null || flows.length > 1 && !flowId) return;
    let alive = true;
    void recoverLibrarySubmission(formId, flowId || undefined).then(result => { if (alive && result) setStarted(result); }).catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Could not recover submission"); });
    return () => { alive = false; };
  }, [formId, starterAssignmentId, flows, flowId]);
  if (started) return <div className="space-y-4">
    <Notice tone="success">Form submitted successfully. {started.workflowName ? `${started.workflowName} has started.` : started.instanceId ? "The workflow has started." : "Your answers have been saved."} {started.referenceNumber}</Notice>
    {started.assignmentSummary?.map((item, index) => <p className="text-sm text-champagne" key={index}>{item.stageName}: {item.employeeName}</p>)}
    {started.ownWorkTargets?.[0] ? <a className="text-gold underline" href={fmsAssignedWorkPath(started.ownWorkTargets[0])}>Open my next work</a> : null}
    {!starterAssignmentId ? <Button onClick={() => { void beginNewLibrarySubmission(formId, flowId || undefined).then(() => { setStarted(null); setGeneration(n => n + 1); }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not start another submission")); }} variant="secondary">Start another submission</Button> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
  </div>;
  return <>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {!starterAssignmentId && flows === null ? <Notice>Loading available workflows…</Notice> : null}
    {flows && flows.length > 1 ? <label className="mb-4 block text-sm text-champagne">Workflow to start<select aria-label="Workflow to start" className="field mt-1" onChange={event => setFlowId(event.target.value)} value={flowId}><option value="">Choose a workflow</option>{flows.map(flow => <option key={flow.flowId} value={flow.flowId}>{flow.name} (v{flow.version})</option>)}</select></label> : null}
    <FormRenderer {...renderer} key={generation} onSubmit={async answers => {
      if (!starterAssignmentId && (flows === null || flows.length > 1 && !flowId)) throw new Error("Choose the workflow before submitting this form.");
      const result = starterAssignmentId ? await submitFmsStarterAssignment(formId, starterAssignmentId, answers) : await submitStandaloneFormAndStartFms(formId, answers, flowId || undefined);
      setStarted(result); await onSaved();
    }} />
  </>;
}
