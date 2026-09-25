"use client";

import { type ComponentProps, useState } from "react";
import { EntryQueue } from "@/components/entry-queue";
import { LeadForm, type LeadField, type LeadOption } from "@/components/lead-form";

type EntryQueueProps = ComponentProps<typeof EntryQueue>;

export function WalkinStart({ entryQueueProps, fields, options, lookupOptions, actorId }: { entryQueueProps: EntryQueueProps; fields: LeadField[]; options: LeadOption[]; lookupOptions: Record<string, string[]>; actorId: string }) {
  const [choice, setChoice] = useState<"" | "client" | "lead">("");
  if (!choice) return <section className="mt-6 max-w-3xl rounded-xl border bg-white p-6"><h2 className="text-xl font-semibold">Who are you registering?</h2><p className="mt-2 text-sm text-stone-600">Choose Client for a physical walk-in, or Lead for a remote enquiry.</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><button type="button" onClick={() => setChoice("client")} className="rounded-lg border-2 border-amber-800 bg-amber-50 p-5 text-left"><b className="block text-lg">CLIENT</b><span className="mt-1 block text-sm text-stone-700">Physical walk-in: register the queue entry, then complete the existing walk-in form.</span></button><button type="button" onClick={() => setChoice("lead")} className="rounded-lg border-2 border-stone-400 p-5 text-left"><b className="block text-lg">LEAD</b><span className="mt-1 block text-sm text-stone-700">Remote contact: calling, exhibition, Instagram, WhatsApp, or another configured source.</span></button></div></section>;
  return <section><button type="button" onClick={() => setChoice("")} className="mt-5 text-sm font-medium text-amber-800 underline">Back to registration type</button>{choice === "client" ? <EntryQueue {...entryQueueProps} /> : <LeadForm fields={fields} options={options} lookupOptions={lookupOptions} actorId={actorId} />}</section>;
}
