"use client";

import { type ComponentProps, useMemo, useState } from "react";
import { CRM_QUEUE_TARGETS, CRM_WALKIN_TARGETS, crmLeadTargets } from "@jewelos/core";
import { EntryQueue } from "@/components/entry-queue";
import { LeadForm, type LeadField, type LeadOption } from "@/components/lead-form";
import { CrmFormSettingsButton, LinkedLeadRegistration, LinkedQueueRegistration, LinkNeedsAttention, linkFor, useCrmFormLinks } from "@/components/crm-linked-forms";
import { useRouter, useSearchParams } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

type EntryQueueProps = ComponentProps<typeof EntryQueue>;

// crm-port: the registration choice is kept in the address (?register=client|lead, owner request
// 2026-11-03), so the CLIENT QUEUE tab, browser back/forward and a shared address open the same view.
export function registrationChoice(value: string | null): "" | "client" | "lead" {
  return value === "client" || value === "lead" ? value : "";
}

export function WalkinStart({ entryQueueProps, fields, options, lookupOptions, actorId }: { entryQueueProps: EntryQueueProps; fields: LeadField[]; options: LeadOption[]; lookupOptions: Record<string, string[]>; actorId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const choice = registrationChoice(searchParams.get("register"));
  // crm-port: Form Builder forms linked in CRM Form Settings (2026-11-03); the standard forms stay until a link is usable.
  const { host, links, loading } = useCrmFormLinks();
  const [settingsOpenedFromNotice, setSettingsOpenedFromNotice] = useState(0);
  const targets = useMemo(() => ({ queue: CRM_QUEUE_TARGETS, lead: crmLeadTargets(fields), walkin: CRM_WALKIN_TARGETS }), [fields]);
  const leadSetup = useMemo(() => ({ fields, routes: options, lookupOptions }), [fields, options, lookupOptions]);
  const queueLink = linkFor(links, "queue", targets.queue);
  const leadLink = linkFor(links, "lead", targets.lead);
  function choose(next: "" | "client" | "lead") {
    const params = new URLSearchParams(searchParams);
    params.delete("completed"); params.delete("completedClientId");
    if (next) params.set("register", next); else params.delete("register");
    router.push(`/queue${params.size ? `?${params}` : ""}`);
  }
  const settings = host && links ? <div className="crm-form-settings-bar"><CrmFormSettingsButton host={host} key={settingsOpenedFromNotice} leadSetup={leadSetup} links={links} openOnMount={settingsOpenedFromNotice > 0} targets={targets} /></div> : null;
  const openSettings = () => setSettingsOpenedFromNotice((count) => count + 1);
  if (!choice) return <>{settings}<section className="mt-6 max-w-3xl rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">Who are you registering?</h2><p className="mt-2 text-sm text-stone-600">Choose Client / Walk-in for a customer in the store, or Lead for a remote enquiry.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><button type="button" onClick={() => choose("client")} className="rounded-lg border-2 border-amber-800 bg-amber-50 p-5 text-left"><b className="block text-lg">CLIENT / WALK-IN</b><span className="mt-1 block text-sm text-stone-700">A customer visiting an MK Jewels store: register the queue entry, then complete the walk-in form.</span></button><button type="button" onClick={() => choose("lead")} className="rounded-lg border-2 border-stone-400 p-5 text-left"><b className="block text-lg">LEAD</b><span className="mt-1 block text-sm text-stone-700">A remote enquiry: Instagram, WhatsApp, calling, exhibition, referral, or another configured source.</span></button></div></section></>;
  if (loading) return <section>{settings}<p role="status" className="mt-5 text-sm text-stone-600">Loading the registration form…</p></section>;
  const queueUsable = host && queueLink && !queueLink.issues.length ? queueLink.link : null;
  const leadUsable = host && leadLink && !leadLink.issues.length ? leadLink.link : null;
  const canManage = links?.canManage ?? false;
  return <section>{settings}<button type="button" onClick={() => choose("")} className="mt-5 text-sm font-medium text-amber-800 underline">Back to registration type</button>{choice === "client"
    ? <><LinkNeedsAttention canManage={canManage} onOpenSettings={openSettings} usable={queueLink} /><EntryQueue {...entryQueueProps} registration={host && queueUsable ? ({ branch, branchSelect, onRegistered }) => <LinkedQueueRegistration branch={branch} branchSelect={branchSelect} host={host} link={queueUsable} onRegistered={onRegistered} /> : undefined} /></>
    : <><LinkNeedsAttention canManage={canManage} onOpenSettings={openSettings} usable={leadLink} />{host && leadUsable ? <LinkedLeadRegistration host={host} link={leadUsable} onSaved={() => router.refresh()} /> : <LeadForm fields={fields} options={options} lookupOptions={lookupOptions} actorId={actorId} />}</>}</section>;
}
