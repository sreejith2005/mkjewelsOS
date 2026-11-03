import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { fmsTriggerSource } from "@jewelos/core";
import { loadFmsInstanceTriggerSource, type FmsInstanceTriggerSource } from "./triggerApi";

/**
 * Where an automatically started run came from (0374): the source, when it was saved, and the
 * values the workflow copied. Optional metadata: it renders nothing for form-started runs or on
 * error, and the CRM profile link appears only for people with CRM access (the RPC withholds the id).
 */
export function FmsTriggerSource({ instanceId }: { instanceId: string }) {
  const [source, setSource] = useState<FmsInstanceTriggerSource | null>(null);
  useEffect(() => {
    let active = true;
    void loadFmsInstanceTriggerSource(instanceId).then((value) => { if (active) setSource(value); }).catch(() => { if (active) setSource(null); });
    return () => { active = false; };
  }, [instanceId]);
  if (!source) return null;
  const label = fmsTriggerSource(source.sourceType)?.label ?? "Saved submission";
  return <section className="space-y-2 rounded-xl border border-gold/20 px-3 py-2 text-sm" data-testid="fms-trigger-source">
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-soft-grey"><Zap aria-hidden="true" className="size-3.5 text-gold-secondary" /><span className="font-semibold text-champagne">Started automatically</span><span>from {label}{source.occurredAt ? ` · ${new Date(source.occurredAt).toLocaleString()}` : ""}</span></p>
    {source.values.length ? <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">{source.values.map((item) => [<dt className="text-soft-grey" key={`${item.label}-k`}>{item.label}</dt>, <dd className="break-words text-white" key={`${item.label}-v`}>{item.value}</dd>])}</dl> : null}
    {source.crmClientId ? <a className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-secondary underline" href={`/crm/clients/${encodeURIComponent(source.crmClientId)}`}>Open CRM client profile</a> : null}
  </section>;
}
