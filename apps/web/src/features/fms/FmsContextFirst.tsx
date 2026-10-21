import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { FmsWorkContext } from "./FmsWorkContext";

/** Every employee execution surface reviews the same persisted context first. */
export function FmsContextFirst({ instanceId, instanceStageId, hasForm, children, reviewRequired = true, onRecordName }: {
  instanceId: string; instanceStageId: string; hasForm: boolean; children: ReactNode; reviewRequired?: boolean; onRecordName?: ((name: string | null) => void) | undefined;
}) {
  const [ready, setReady] = useState(false);
  const [continuing, setContinuing] = useState(false);
  return <>
    <FmsWorkContext instanceId={instanceId} instanceStageId={instanceStageId} onReady={setReady} onRecordName={onRecordName} />
    {reviewRequired && !continuing ? <Button disabled={!ready} onClick={() => setContinuing(true)}>{hasForm ? "Continue to stage form" : "Continue to stage"}</Button> : null}
    {!reviewRequired || continuing ? children : null}
  </>;
}
