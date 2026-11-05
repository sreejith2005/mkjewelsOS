"use client";
import { useEffect, useRef, useState } from "react";
import Link from "@/next-shim/link";
import { crmSupabase } from "@/crm-port/runtime";
import { useCrmRefresh } from "@/crm-port/use-crm-refresh";
import { kolkataDateKey } from "@/lib/business-date";

/** get_crm_operations_summary_v1 (supabase-crm 20261104000300). Read as the asker, so RLS scopes every number. */
export type CrmOperationsSummaryData = {
  from: string; to: string; today: string; generated_at: string;
  queue_pending: number; queue_registered: number; walkin_forms_completed: number;
  store_visits: number; visits_with_outcome: number; purchase_visits: number; not_bought_visits: number; new_leads: number;
  followups_open: number; followups_due_now: number; followups_overdue: number; followup_contacts: number; followups_recovered: number;
  referrals_active: number; referrals_pending_outreach: number; referrals_converted: number;
};
const NUMBER_KEYS = ["queue_pending", "queue_registered", "walkin_forms_completed", "store_visits", "visits_with_outcome", "purchase_visits", "not_bought_visits", "new_leads", "followups_open", "followups_due_now", "followups_overdue", "followup_contacts", "followups_recovered", "referrals_active", "referrals_pending_outreach", "referrals_converted"] as const;

export function parseOperationsSummary(data: unknown): CrmOperationsSummaryData {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid summary");
  const row = data as Record<string, unknown>;
  for (const key of NUMBER_KEYS) if (typeof row[key] !== "number" || !Number.isFinite(row[key])) throw new Error(`Invalid summary value: ${key}`);
  for (const key of ["from", "to", "today", "generated_at"] as const) if (typeof row[key] !== "string") throw new Error(`Invalid summary value: ${key}`);
  return row as unknown as CrmOperationsSummaryData;
}

export type OperationsPeriod = "today" | "this_week" | "this_month";
const PERIODS: readonly [OperationsPeriod, string][] = [["today", "Today"], ["this_week", "This week"], ["this_month", "This month"]];

/** Business dates in Asia/Kolkata: the week starts on Monday, the month on the 1st. */
export function periodRange(period: OperationsPeriod, today = kolkataDateKey()): { from: string; to: string } {
  if (period === "today") return { from: today, to: today };
  const date = new Date(`${today}T12:00:00Z`);
  if (period === "this_month") return { from: `${today.slice(0, 8)}01`, to: today };
  const back = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - back);
  return { from: date.toISOString().slice(0, 10), to: today };
}

/** Purchase visits as a share of visits with a saved outcome; null when there is no denominator. */
export function purchaseConversion(summary: Pick<CrmOperationsSummaryData, "purchase_visits" | "visits_with_outcome">): number | null {
  return summary.visits_with_outcome > 0 ? Math.round((summary.purchase_visits / summary.visits_with_outcome) * 1000) / 10 : null;
}

/** A card opens a filtered Queue / Client Database view, or the insight records behind its number. */
type Card = { label: string; value: string; note: string; href?: string; insight?: InsightMetric };
export type InsightMetric = "visits" | "purchases";

function cards(s: CrmOperationsSummaryData, branch: string): Record<"floor" | "followups" | "referrals", Card[]> {
  const b = branch ? `&branch=${encodeURIComponent(branch)}` : "";
  const qb = branch ? `?branch=${encodeURIComponent(branch)}` : "";
  const period = `${s.from === s.to ? s.from : `${s.from} to ${s.to}`}`;
  const rate = purchaseConversion(s);
  return {
    floor: [
      { label: "Waiting in queue", value: String(s.queue_pending), note: "Pending queue entries now, any day", href: `/queue${qb}` },
      { label: "Registered in queue", value: String(s.queue_registered), note: `Queue entries created, ${period}`, href: `/queue${qb}` },
      { label: "Walk-in forms completed", value: String(s.walkin_forms_completed), note: `Queue entries whose walk-in form was saved, ${period}`, href: `/queue${qb ? `${qb}&` : "?"}tab=recent` },
      { label: "Store visits", value: String(s.store_visits), note: `Saved store visits dated ${period}`, insight: "visits" },
      { label: "Purchase visits", value: String(s.purchase_visits), note: "Visits whose saved outcome includes a purchase. Not invoiced sales.", insight: "purchases" },
      { label: "Walk-in purchase rate", value: rate === null ? "—" : `${rate}%`, note: `${s.purchase_visits} purchase visits ÷ ${s.visits_with_outcome} visits with a saved outcome`, insight: "purchases" },
      { label: "New leads", value: String(s.new_leads), note: `Leads created, ${period}`, href: `/clients?type=lead&created_from=${s.from}&created_to=${s.to}${b}` },
    ],
    followups: [
      { label: "Open Not Bought cases", value: String(s.followups_open), note: "Cases not closed or converted, now", href: `/clients?preset=not_bought&tab=pending${b}` },
      { label: "Due now", value: String(s.followups_due_now), note: "Due today, overdue or without a date", href: `/clients?preset=not_bought&tab=today${b}` },
      { label: "Overdue", value: String(s.followups_overdue), note: "Next follow-up date before today", href: `/clients?preset=not_bought&tab=overdue${b}` },
      { label: "Contacts logged", value: String(s.followup_contacts), note: `Follow-up updates saved by staff, ${period}`, href: `/clients?preset=not_bought&tab=inprocess${b}` },
      { label: "Recovered", value: String(s.followups_recovered), note: `Cases closed as purchased from MK Jewels, ${period}`, href: `/clients?preset=not_bought&tab=done${b}` },
    ],
    referrals: [
      { label: "Active referrals", value: String(s.referrals_active), note: "Referral calls not closed, now", href: `/clients?preset=referrals_received&tab=pending${b}` },
      { label: "Not yet contacted", value: String(s.referrals_pending_outreach), note: "Active referrals with no follow-up saved", href: `/clients?preset=referrals_received&tab=pending&sort=oldest${b}` },
      { label: "Referred people converted", value: String(s.referrals_converted), note: "Linked to a client record, all time", href: `/clients?preset=referrals_received&tab=converted${b}` },
    ],
  };
}

/**
 * The CRM dashboard's operations cards (owner request 2026-11-04): today's floor, follow-up workload
 * and referrals, each with its definition and a link into the matching Queue or Client Database view.
 * Sales value is not shown: CRM has no reconciled invoice source, so purchase outcomes are labelled as such.
 */
export function CrmOperationsSummary({ branches, onOpenInsight }: { branches: readonly { id: string; name: string }[]; onOpenInsight?: ((metric: InsightMetric, range: { from: string; to: string }, branchId: string) => void) | undefined }) {
  const [period, setPeriod] = useState<OperationsPeriod>("today");
  const [branch, setBranch] = useState("");
  const [summary, setSummary] = useState<CrmOperationsSummaryData | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  async function load() {
    const seq = ++generation.current; setError("");
    const range = periodRange(period);
    try {
      const { data, error: readError } = await crmSupabase().rpc("get_crm_operations_summary_v1", { p_from: range.from, p_to: range.to, ...(branch ? { p_branch_id: branch } : {}) });
      if (readError) throw readError;
      if (seq === generation.current) setSummary(parseOperationsSummary(data));
    } catch { if (seq === generation.current) { setSummary(null); setError("Operations summary could not load. Check connection and access, then refresh."); } }
  }
  useEffect(() => { void load(); }, [period, branch]);
  useCrmRefresh(load);
  const groups = summary ? cards(summary, branch) : null;
  const section = (title: string, list: Card[]) => <section className="crm-ops-group" aria-label={title}><h2 className="text-sm font-semibold uppercase tracking-wider">{title}</h2><div className="crm-ops-cards">{list.map((card) => { const content = <><span className="crm-ops-label">{card.label}</span><span className="crm-ops-value tabular-nums">{card.value}</span><span className="crm-ops-note">{card.note}</span></>; const metric = card.insight; return metric && summary && onOpenInsight ? <button key={card.label} type="button" className="crm-ops-card" onClick={() => onOpenInsight(metric, { from: summary.from, to: summary.to }, branch)}>{content}</button> : card.href ? <Link key={card.label} href={card.href} className="crm-ops-card">{content}</Link> : <div key={card.label} className="crm-ops-card">{content}</div>; })}</div></section>;
  return <section className="crm-ops" aria-labelledby="crm-ops-title">
    <header className="crm-ops-head"><div><p className="text-xs font-semibold uppercase tracking-widest text-stone-500">CRM operations</p><h1 id="crm-ops-title" className="mt-1 text-3xl font-semibold">Today at the store and what needs action</h1>{summary ? <p className="mt-1 text-xs text-stone-500">{summary.from === summary.to ? summary.from : `${summary.from} to ${summary.to}`} (Asia/Kolkata) · Updated {new Date(summary.generated_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}</p> : null}</div>
      <div className="crm-ops-controls"><div className="crm-ops-periods" role="group" aria-label="Period">{PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}</div>
        <label className="text-xs font-medium">Branch<select aria-label="Operations branch" value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">All branches you can see</option>{branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></header>
    {error ? <p role="alert" className="crm-notice crm-notice--error">{error}</p> : null}
    {!summary && !error ? <p role="status" className="text-sm text-stone-600">Loading operations…</p> : null}
    {groups ? <>{section("Store floor", groups.floor)}{section("Not Bought follow-ups", groups.followups)}{section("Referrals", groups.referrals)}</> : null}
  </section>;
}
