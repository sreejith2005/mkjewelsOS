"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { createClient } from "@/lib/supabase/client";
import { getCrmUser } from "@/crm-port/crm-user"; // crm-port: see getCrmUser

const RESPONSES = ["CONNECTED", "NOT PICKED", "SWITCHED OFF", "WHATSAPP ONLY", "WRONG NUMBER"] as const;
type PendingCall = { phone: string; durationSeconds: number; recordingStatus: "pending" | "not_found" | "failed" | "uploaded" };

export function PostCallInbox() {
  const [pending, setPending] = useState<PendingCall | null>(null); const [leadId, setLeadId] = useState<string | null>(null); const [response, setResponse] = useState<(typeof RESPONSES)[number]>("CONNECTED"); const [remark, setRemark] = useState(""); const [nextDate, setNextDate] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { void (async () => {
    const { Capacitor, registerPlugin } = await import("@capacitor/core"); if (!Capacitor.isNativePlatform()) return;
    const plugin = registerPlugin<{ consumePendingCall(): Promise<{ pending: boolean; phone: string | null; durationSeconds: number; recordingStatus: PendingCall["recordingStatus"] }> }>("LeadCalling");
    const result = await plugin.consumePendingCall(); if (!result.pending || !result.phone) return;
    setPending({ phone: result.phone, durationSeconds: result.durationSeconds, recordingStatus: result.recordingStatus });
    const db = createClient() as any;
    const { data } = await db.from("leads").select("id").eq("phone_number", result.phone).maybeSingle(); setLeadId(data?.id ?? null);
  })(); }, []);
  async function save(event: FormEvent) { event.preventDefault(); if (!pending || !leadId) return; const db = createClient() as any; const { data: { user } } = await getCrmUser(db) /* crm-port: auth.getUser().id is used as entered_by -> crm.current_crm_user_id() */; if (!user) { setMessage("Your session expired. Sign in again to save this call."); return; } const { error } = await db.from("lead_call_history").insert({ lead_id: leadId, call_response: response, remark: remark.trim() || null, next_followup_date: nextDate || null, call_duration_seconds: pending.durationSeconds || null, recording_upload_status: pending.recordingStatus, entered_by: user.id }); if (error) { setMessage("Could not save this interaction. Please try again."); return; } setMessage("Call interaction saved."); setPending(null); }
  if (!pending) return null;
  return <aside className="fixed bottom-4 right-4 z-50 w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-amber-300 bg-white p-4 shadow-xl"><h2 className="font-semibold">Add Interaction</h2><p className="mt-1 text-sm text-stone-600">{pending.phone} · {pending.durationSeconds}s · recording: {pending.recordingStatus.replace("_", " ")}</p>{leadId ? <form className="mt-3 grid gap-3" onSubmit={(event) => void save(event)}><select aria-label="Call response" className="rounded border p-2" value={response} onChange={(event) => setResponse(event.target.value as typeof response)}>{RESPONSES.map((item) => <option key={item}>{item}</option>)}</select><textarea className="rounded border p-2" placeholder="Remark (optional)" value={remark} onChange={(event) => setRemark(event.target.value)} /><input className="rounded border p-2" type="date" value={nextDate} onChange={(event) => setNextDate(event.target.value)} /><button className="rounded bg-amber-800 px-3 py-2 font-medium text-white">Save call</button></form> : <p className="mt-3 text-sm">No lead matches this number. <Link className="underline" href={`/leads/new?post_call_phone=${pending.phone}`}>Create the lead</Link> before logging the call.</p>}{message ? <p role="status" className="mt-2 text-sm">{message}</p> : null}</aside>;
}
