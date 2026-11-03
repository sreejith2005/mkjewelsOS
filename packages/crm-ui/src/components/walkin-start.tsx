"use client";

import { type ComponentProps } from "react";
import { EntryQueue } from "@/components/entry-queue";
import { LeadForm, type LeadField, type LeadOption } from "@/components/lead-form";
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
  function choose(next: "" | "client" | "lead") {
    const params = new URLSearchParams(searchParams);
    params.delete("completed"); params.delete("completedClientId");
    if (next) params.set("register", next); else params.delete("register");
    router.push(`/queue${params.size ? `?${params}` : ""}`);
  }
  if (!choice) return <section className="mt-6 max-w-3xl rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">Who are you registering?</h2><p className="mt-2 text-sm text-stone-600">Choose Client / Walk-in for a customer in the store, or Lead for a remote enquiry.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><button type="button" onClick={() => choose("client")} className="rounded-lg border-2 border-amber-800 bg-amber-50 p-5 text-left"><b className="block text-lg">CLIENT / WALK-IN</b><span className="mt-1 block text-sm text-stone-700">A customer visiting an MK Jewels store: register the queue entry, then complete the walk-in form.</span></button><button type="button" onClick={() => choose("lead")} className="rounded-lg border-2 border-stone-400 p-5 text-left"><b className="block text-lg">LEAD</b><span className="mt-1 block text-sm text-stone-700">A remote enquiry: Instagram, WhatsApp, calling, exhibition, referral, or another configured source.</span></button></div></section>;
  return <section><button type="button" onClick={() => choose("")} className="mt-5 text-sm font-medium text-amber-800 underline">Back to registration type</button>{choice === "client" ? <EntryQueue {...entryQueueProps} /> : <LeadForm fields={fields} options={options} lookupOptions={lookupOptions} actorId={actorId} />}</section>;
}
