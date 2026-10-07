"use client";

import { useState } from "react";

import { storedPhone } from "@/lib/phone";

type NativeLeadCalling = { startCall(options: { phone: string }): Promise<{ started: boolean }> };
async function nativeCalling(): Promise<NativeLeadCalling | null> {
  const { Capacitor, registerPlugin } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;
  return registerPlugin<NativeLeadCalling>("LeadCalling");
}
export function CallButton({ phone }: { phone: string }) {
  const [message, setMessage] = useState("");
  async function call() {
    // Stored numbers carry their country code (919987323456, 6591234567); dial them in + form.
    const digits = storedPhone(phone);
    if (!digits) { setMessage("This contact does not have a valid mobile number."); return; }
    const dial = `+${digits}`;
    try { const plugin = await nativeCalling(); if (plugin) await plugin.startCall({ phone: dial }); else window.location.href = `tel:${dial}`; }
    catch { setMessage("Could not start call monitoring. Check Phone permission and try again."); }
  }
  return <span><button type="button" className="rounded border border-amber-800 px-2 py-1 text-xs font-medium text-amber-900" onClick={() => void call()}>Call</button>{message ? <span className="ml-2 text-xs text-red-700">{message}</span> : null}</span>;
}
