import { useEffect, useState, type ComponentProps } from "react";
import { fmsAssignedWorkPath } from "@jewelos/core";
import { beginNewLibrarySubmission, beginNewFmsStartingFlow, fmsStartConfirmationFromWork, listFmsFormStarters, recoverFmsStartingFlow, recoverFmsStartingWork, recoverLibrarySubmission, type FmsStartConfirmation } from "@jewelos/data/fms/work";
import { CheckCircle2 } from "lucide-react";
import { Button, Notice } from "@/components/ui";
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
    <div aria-label="Submission result" className="space-y-1 rounded-2xl border border-success/40 bg-success/10 p-4" role="region">
      <h2 className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />Submitted</h2>
      {sentToLine(started.assignmentSummary) ? <p className="text-sm text-task-text">{sentToLine(started.assignmentSummary)}</p> : null}
    </div>
    {started.ownWorkTargets?.[0] ? <a className="inline-flex min-h-12 items-center justify-center rounded-lg bg-gold-sheen px-4 py-2 text-sm font-semibold text-on-gold shadow-gold" href={fmsAssignedWorkPath(started.ownWorkTargets[0])}>Open my next step</a> : null}
    {!starterAssignmentId ? <Button className="min-h-12" onClick={() => { void (selectedFlow ? beginNewFmsStartingFlow(selectedFlow.flowId) : beginNewLibrarySubmission(formId)).then(() => { setStarted(null); setGeneration(n => n + 1); }).catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not start another submission")); }} variant="secondary">Fill again</Button> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
  </div>;
  return <>
    {renderer.definition.description ? <p className="mb-4 px-1 text-sm text-soft-grey">{renderer.definition.description}</p> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {!starterAssignmentId && flows === null ? <Notice>Loading…</Notice> : null}
    {flows && flows.length > 1 ? <label className="mb-4 block text-sm text-champagne">Workflow to start<select aria-label="Workflow to start" className="field mt-1" onChange={event => setFlowId(event.target.value)} value={flowId}><option value="">Choose a workflow</option>{flows.map(flow => <option key={flow.flowId} value={flow.flowId}>{flow.name}</option>)}</select></label> : null}
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
