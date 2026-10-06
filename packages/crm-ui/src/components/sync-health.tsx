"use client";

// Two-project addition (2026-10-05): CRM sync health for super admins. Counts only, from
// crm_sync_health() (staff roster sync from JewelOS, walk-in events to JewelOS, Sheet ingest).
// Design: docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md.
// Google Sheet two-way sync block (2026-10-06, https://claude.ai/artifact/MBHPPoH1pRbPJF9jExCL2D).
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

/** The Sheet sync is overdue when its last finished run is more than 30 minutes old. */
export const SHEET_SYNC_OVERDUE_MS = 30 * 60 * 1000;

function times(value: unknown): string {
  if (!value || typeof value !== "object") return "NONE";
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length ? entries.map(([key, at]) => `${key}: ${when(at)}`).join(" · ") : "NONE";
}

function report(value: unknown): string {
  if (!value || typeof value !== "object") return "NONE";
  const run = value as { mode?: string; status?: string; finished_at?: string; counts?: { push?: Record<string, unknown>; crm_only?: unknown } };
  const tabs = Object.entries(run.counts?.push ?? {}).map(([tab, n]) => `${tab} — ${counts(n)}`);
  if (run.counts?.crm_only !== undefined) tabs.push(`CRM CLIENTS NOT IN THE SHEET: ${String(run.counts.crm_only)}`);
  return [`${String(run.mode ?? "").replaceAll("_", " ").toUpperCase()} ${String(run.status ?? "").toUpperCase()} ${when(run.finished_at)}`, ...tabs].join(" | ");
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
  const sheet = (health?.sheet ?? {}) as Record<string, unknown>;
  const lastSheetSync = typeof sheet.last_finished_live_at === "string" ? sheet.last_finished_live_at : null;
  const sheetOverdue = lastSheetSync !== null && Date.now() - new Date(lastSheetSync).getTime() > SHEET_SYNC_OVERDUE_MS;
  const rows: Array<[string, string]> = health ? [
    ["ACTIVE CRM ACCESS GRANTS", String(health.active_grants ?? 0)],
    ["STAFF UPDATES FROM JEWELOS (7 DAYS)", counts(health.staff_events_7d)],
    ["LAST STAFF UPDATE", when(health.last_staff_event_at)],
    ["STAFF BLOCKED (NEED OWNER ACTION)", counts(health.blocked_staff)],
    ["LAST DAILY RECONCILIATION", last ? `${when(last.at)} · ${counts(last.counts)}` : "NEVER"],
    ["WALK-IN EVENTS TO JEWELOS: OPEN / FAILING / DEAD", `${String(health.outbound_open ?? 0)} / ${String(health.outbound_failing ?? 0)} / ${String(health.outbound_dead ?? 0)}`],
    ["LAST WALK-IN EVENT DELIVERED", when(health.outbound_last_delivered_at)],
    ["SHEET WALK-IN INGEST (7 DAYS)", counts(health.walkin_ingest_7d)],
    ["GOOGLE SHEET: LAST TWO-WAY SYNC", sheetOverdue ? `OVERDUE — ${when(lastSheetSync)}` : when(lastSheetSync)],
    ["GOOGLE SHEET: WEB-APP CHANGES WAITING", `${String(sheet.waiting_for_sheet ?? 0)}${sheet.oldest_waiting_at ? ` · OLDEST ${when(sheet.oldest_waiting_at)}` : ""}`],
    ["GOOGLE SHEET: CONFLICTS (7 DAYS)", counts(sheet.conflicts_7d)],
    ["GOOGLE SHEET: OPEN ROW ERRORS", counts(sheet.open_errors)],
    ["GOOGLE SHEET: LAST CHANGE PER TAB", times(sheet.last_push_by_tab)],
    ["GOOGLE SHEET: LAST IMPORT REPORT", report(sheet.last_import)],
  ] : [];

  return <section className="mt-6 overflow-hidden rounded-xl border bg-white" aria-labelledby="crm-sync-health"><div className="border-b p-4"><h2 id="crm-sync-health" className="font-semibold">CRM SYNC HEALTH</h2><p className="text-sm text-stone-600">Links between JewelOS and the CRM. Counts only.</p></div>{failed ? <p className="p-4 text-sm text-stone-600">Sync health could not be loaded.</p> : !health ? <p className="p-4 text-sm text-stone-600">Loading…</p> : rows.map(([label, value]) => <div key={label} className="grid gap-1 border-t p-4 text-sm md:grid-cols-[320px_1fr]"><span className="text-stone-600">{label}</span><b className={value.startsWith("OVERDUE") ? "text-red-700" : undefined}>{value}</b></div>)}</section>;
}
