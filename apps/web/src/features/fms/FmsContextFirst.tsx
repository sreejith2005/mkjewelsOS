import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "@/components/ui";
import { FmsEarlierAnswersContext } from "./earlierAnswers";
import { FmsWorkContext } from "./FmsWorkContext";
import { FmsWorkSteps } from "./FmsWorkSteps";

/** Every employee execution surface reviews the same persisted context first. */
export function FmsContextFirst({ instanceId, instanceStageId, hasForm, children, reviewRequired = true, onRecordName, showSteps = false }: {
  instanceId: string; instanceStageId: string; hasForm: boolean; children: ReactNode; reviewRequired?: boolean; onRecordName?: ((name: string | null) => void) | undefined; showSteps?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [earlierForms, setEarlierForms] = useState(0);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const workRef = useRef<HTMLDivElement>(null);
  // After reading, bring the employee straight to their own work instead of the top of the answers.
  useEffect(() => { if (continuing) workRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }, [continuing]);
  const working = !reviewRequired || continuing;
  // While filling the form, the earlier answers open over it; the typed answers stay as they are.
  const openEarlier = useMemo(() => earlierForms > 0 ? () => setEarlierOpen(true) : null, [earlierForms]);
  return <>
    {showSteps && reviewRequired ? <FmsWorkSteps current={working ? 2 : 1} /> : null}
    <FmsWorkContext collapsed={continuing} instanceId={instanceId} instanceStageId={instanceStageId} onPreviousForms={setEarlierForms} onReady={setReady} onRecordName={onRecordName} />
    {reviewRequired && !continuing ? <div className="space-y-2">
      <Button className="min-h-12 w-full sm:w-auto" disabled={!ready} onClick={() => setContinuing(true)}>{hasForm ? "Continue to form" : "Continue"}</Button>
    </div> : null}
    {working ? <div className="scroll-mt-24" ref={workRef}><FmsEarlierAnswersContext.Provider value={openEarlier}>{children}</FmsEarlierAnswersContext.Provider></div> : null}
    {earlierOpen ? <Modal mobileFullscreen onClose={() => setEarlierOpen(false)} title="Earlier answers" wide>
      <div className="mx-auto max-w-2xl space-y-4">
        <FmsWorkContext expandAll instanceId={instanceId} instanceStageId={instanceStageId} />
        <Button className="min-h-12 w-full" onClick={() => setEarlierOpen(false)}>Back to my form</Button>
      </div>
    </Modal> : null}
  </>;
}
