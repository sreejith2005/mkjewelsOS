import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { FmsWorkContext } from "./FmsWorkContext";
import { FmsWorkSteps } from "./FmsWorkSteps";

/** Every employee execution surface reviews the same persisted context first. */
export function FmsContextFirst({ instanceId, instanceStageId, hasForm, children, reviewRequired = true, onRecordName, showSteps = false }: {
  instanceId: string; instanceStageId: string; hasForm: boolean; children: ReactNode; reviewRequired?: boolean; onRecordName?: ((name: string | null) => void) | undefined; showSteps?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const workRef = useRef<HTMLDivElement>(null);
  // After reading, bring the employee straight to their own work instead of the top of the answers.
  useEffect(() => { if (continuing) workRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }, [continuing]);
  const working = !reviewRequired || continuing;
  return <>
    {showSteps && reviewRequired ? <FmsWorkSteps current={working ? 2 : 1} /> : null}
    <FmsWorkContext collapsed={continuing} instanceId={instanceId} instanceStageId={instanceStageId} onReady={setReady} onRecordName={onRecordName} />
    {reviewRequired && !continuing ? <div className="space-y-2">
      <Button className="min-h-12 w-full sm:w-auto" disabled={!ready} onClick={() => setContinuing(true)}>{hasForm ? "Continue to stage form" : "Continue to stage"}</Button>
    </div> : null}
    {working ? <div className="scroll-mt-24" ref={workRef}>{children}</div> : null}
  </>;
}
