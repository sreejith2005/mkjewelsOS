import { useEffect, useState } from "react";
import { crmRecordType } from "@jewelos/core";
import { customerCommercial } from "@/lib/customer-integration";

/**
 * Lead → Store visit completed → Client, using the same rule as the CRM Client Database, with
 * verified purchase evidence shown separately (a store visit is never treated as a sale).
 */
export function CustomerLifecycle({ clientId, lifecycleStage, totalVisits }: { clientId: string; lifecycleStage: string | null; totalVisits: number | null }) {
  const type = crmRecordType({ lifecycleStage, totalVisits });
  const [purchase, setPurchase] = useState<{ clientId: string; classification: string } | null>(null);
  useEffect(() => {
    let active = true;
    void customerCommercial(clientId).then(value => { if (active) setPurchase({ clientId, classification: value.classification }); }).catch(() => { if (active) setPurchase(null); });
    return () => { active = false; };
  }, [clientId]);
  const visits = totalVisits ?? 0;
  const steps: Array<[string, boolean]> = [["Lead", true], ["Store visit completed", visits > 0], ["Client", type === "client"]];
  return <div className="crm-lifecycle" aria-label="Customer lifecycle" data-testid="customer-lifecycle">
    <p className="crm-lifecycle-type"><strong>{type === "lead" ? "LEAD" : "CLIENT"}</strong>{type === "client" && visits === 0 ? <span> · client record without a recorded store visit</span> : null}</p>
    <ol className="crm-lifecycle-steps">{steps.map(([label, done]) => <li key={label} data-done={done ? "true" : "false"}>{label}</li>)}</ol>
    {purchase?.clientId === clientId ? <p className="crm-lifecycle-purchase">Purchase evidence: {purchase.classification === "Unknown" ? "Not enough evidence yet" : purchase.classification}</p> : null}
  </div>;
}
