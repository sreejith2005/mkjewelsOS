"use client";

// Two-project addition (2026-10-05): CRM sync health for super admins. Counts only, from
// crm_sync_health() (staff roster sync from JewelOS, walk-in events to JewelOS, Sheet ingest).
// Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md.
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Health = Record<string, unknown>;

function counts(value: unknown): string {
  if (!value || typeof value !== "object") return "NONE";
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length ? entries.map(([key, n]) => `${key.replaceAll("_", " ").toUpperCase()}: ${String(n)}`).join(" · ") : "NONE";
}

function when(value: unknown): string {
  return typeof value === "string" ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "NEVER";
}

export function SyncHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    void createClient().rpc("crm_sync_health").then(({ data, error }) => {
      if (!current) return;
      if (error || !data || typeof data !== "object") setFailed(true);
      else setHealth(data as Health);
    });
    return () => { current = false; };
  }, []);

  const last = health?.last_reconciliation as { at?: string; counts?: Record<string, unknown> } | null | undefined;
  const rows: Array<[string, string]> = health ? [
    ["ACTIVE CRM ACCESS GRANTS", String(health.active_grants ?? 0)],
    ["STAFF UPDATES FROM JEWELOS (7 DAYS)", counts(health.staff_events_7d)],
    ["LAST STAFF UPDATE", when(health.last_staff_event_at)],
    ["STAFF BLOCKED (NEED OWNER ACTION)", counts(health.blocked_staff)],
    ["LAST DAILY RECONCILIATION", last ? `${when(last.at)} · ${counts(last.counts)}` : "NEVER"],
    ["WALK-IN EVENTS TO JEWELOS: OPEN / FAILING / DEAD", `${String(health.outbound_open ?? 0)} / ${String(health.outbound_failing ?? 0)} / ${String(health.outbound_dead ?? 0)}`],
    ["LAST WALK-IN EVENT DELIVERED", when(health.outbound_last_delivered_at)],
    ["SHEET WALK-IN INGEST (7 DAYS)", counts(health.walkin_ingest_7d)],
  ] : [];

  return <section className="mt-6 overflow-hidden rounded-xl border bg-white" aria-labelledby="crm-sync-health"><div className="border-b p-4"><h2 id="crm-sync-health" className="font-semibold">CRM SYNC HEALTH</h2><p className="text-sm text-stone-600">Links between JewelOS and the CRM. Counts only.</p></div>{failed ? <p className="p-4 text-sm text-stone-600">Sync health could not be loaded.</p> : !health ? <p className="p-4 text-sm text-stone-600">Loading…</p> : rows.map(([label, value]) => <div key={label} className="grid gap-1 border-t p-4 text-sm md:grid-cols-[320px_1fr]"><span className="text-stone-600">{label}</span><b>{value}</b></div>)}</section>;
}
