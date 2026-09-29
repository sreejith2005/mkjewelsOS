"use client";

import { useState } from "react";

type NativeLeadCalling = { startCall(options: { phone: string }): Promise<{ started: boolean }> };
async function nativeCalling(): Promise<NativeLeadCalling | null> {
  const { Capacitor, registerPlugin } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;
  return registerPlugin<NativeLeadCalling>("LeadCalling");
}
export function CallButton({ phone }: { phone: string }) {
  const [message, setMessage] = useState("");
  async function call() {
    const digits = phone.replace(/\D/g, "").slice(-10);
    if (digits.length !== 10) { setMessage("This contact does not have a valid 10-digit mobile number."); return; }
    try { const plugin = await nativeCalling(); if (plugin) await plugin.startCall({ phone: digits }); else window.location.href = `tel:${digits}`; }
    catch { setMessage("Could not start call monitoring. Check Phone permission and try again."); }
  }
  return <span><button type="button" className="rounded border border-amber-800 px-2 py-1 text-xs font-medium text-amber-900" onClick={() => void call()}>Call</button>{message ? <span className="ml-2 text-xs text-red-700">{message}</span> : null}</span>;
}
