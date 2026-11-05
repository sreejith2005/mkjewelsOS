"use client";

import { type ComponentProps, useMemo, useState } from "react";
import { CRM_QUEUE_TARGETS, CRM_WALKIN_TARGETS, crmLeadTargets } from "@jewelos/core";
import { EntryQueue } from "@/components/entry-queue";
import { LeadForm, type LeadField, type LeadOption } from "@/components/lead-form";
import { CrmFormSettingsButton, LinkedLeadRegistration, LinkedQueueRegistration, LinkNeedsAttention, linkFor, useCrmFormLinks } from "@/components/crm-linked-forms";
import { useRouter, useSearchParams } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

type EntryQueueProps = ComponentProps<typeof EntryQueue>;

// crm-port: Client Queue is the CRM landing view (owner request 2026-11-04). The queue, quick client
// registration and the queue controls show at once; REGISTER LEAD opens the full lead form in its own
// view (?register=lead, so back/forward and a shared address work) with a way back to the queue.
// Older ?register=client addresses open the queue, as does no parameter.
export function registrationChoice(value: string | null): "client" | "lead" {
  return value === "lead" ? "lead" : "client";
}

export function WalkinStart({ entryQueueProps, fields, options, lookupOptions, actorId }: { entryQueueProps: EntryQueueProps; fields: LeadField[]; options: LeadOption[]; lookupOptions: Record<string, string[]>; actorId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const choice = registrationChoice(searchParams.get("register"));
  // crm-port: Form Builder forms linked in CRM Form Settings (2026-11-03); the standard forms stay until a link is usable.
  const { host, links, loading } = useCrmFormLinks();
  const [settingsOpenedFromNotice, setSettingsOpenedFromNotice] = useState(0);
  // Three purposes stay distinct: quick queue intake, the full walk-in visit, and the lead.
  const targets = useMemo(() => ({ queue: CRM_QUEUE_TARGETS, lead: crmLeadTargets(fields), walkin: CRM_WALKIN_TARGETS }), [fields]);
  const leadSetup = useMemo(() => ({ fields, routes: options, lookupOptions }), [fields, options, lookupOptions]);
  const queueLink = linkFor(links, "queue", targets.queue);
  const leadLink = linkFor(links, "lead", targets.lead);
  function choose(next: "client" | "lead") {
    const params = new URLSearchParams(searchParams);
    params.delete("completed"); params.delete("completedClientId");
    if (next === "lead") params.set("register", "lead"); else params.delete("register");
    router.push(`/queue${params.size ? `?${params}` : ""}`);
  }
  const settings = host && links ? <CrmFormSettingsButton host={host} key={settingsOpenedFromNotice} leadSetup={leadSetup} links={links} openOnMount={settingsOpenedFromNotice > 0} targets={targets} /> : null;
  const openSettings = () => setSettingsOpenedFromNotice((count) => count + 1);
  const queueUsable = host && queueLink && !queueLink.issues.length ? queueLink.link : null;
  const leadUsable = host && leadLink && !leadLink.issues.length ? leadLink.link : null;
  const canManage = links?.canManage ?? false;
  const actions = <div className="crm-queue-actions" role="group" aria-label="Register">
    <button type="button" className="crm-queue-action" aria-pressed={choice === "client"} onClick={() => choose("client")}><b>REGISTER CLIENT</b><small>Store walk-in: queue entry with branch, name and mobile</small></button>
    <button type="button" className="crm-queue-action" aria-pressed={choice === "lead"} onClick={() => choose("lead")}><b>REGISTER LEAD</b><small>Remote enquiry: the full lead form</small></button>
  </div>;
  return <section className="crm-queue-page">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-wider text-amber-800">Front desk</p><h1 className="mt-1 text-3xl font-semibold">Client queue</h1></div>{settings ? <div className="crm-form-settings-bar">{settings}</div> : null}</div>
    {actions}
    {choice === "lead"
      ? <section aria-labelledby="register-lead-heading"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="register-lead-heading" className="text-lg font-semibold">REGISTER LEAD</h2><button type="button" onClick={() => choose("client")} className="text-sm font-medium text-amber-800 underline">Back to queue</button></div>
          {loading ? <p role="status" className="mt-3 text-sm text-stone-600">Loading the lead form…</p> : <><LinkNeedsAttention canManage={canManage} onOpenSettings={openSettings} usable={leadLink} />{host && leadUsable ? <LinkedLeadRegistration host={host} link={leadUsable} onSaved={() => router.refresh()} /> : <LeadForm fields={fields} options={options} lookupOptions={lookupOptions} actorId={actorId} />}</>}</section>
      : <>{loading ? null : <LinkNeedsAttention canManage={canManage} onOpenSettings={openSettings} usable={queueLink} />}
          {/* The queue shows at once; a linked Form Builder intake replaces the quick form once the links have loaded. */}
          <EntryQueue {...entryQueueProps} registration={loading ? () => <p role="status" className="mt-3 text-sm text-stone-600">Loading the registration form…</p> : host && queueUsable ? ({ branch, branchSelect, onRegistered }) => <LinkedQueueRegistration branch={branch} branchSelect={branchSelect} host={host} link={queueUsable} onRegistered={onRegistered} /> : undefined} /></>}
  </section>;
}
