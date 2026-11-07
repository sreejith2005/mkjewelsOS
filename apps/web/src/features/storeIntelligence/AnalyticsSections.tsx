import { useState, type ReactNode } from "react";
import {
  SI_CATEGORY_LABEL, SI_DEFINITIONS, SI_ELEMENT_LABEL, SI_PRICE_BAND_LABEL, SI_PRICE_BANDS, SI_RANK_METRIC_LABEL, SI_SIGNAL_LABEL, SI_TIER_LABEL, siBranchActions, siChange,
  siCorrelationText, siOpportunity, siRank, siRate, siRateText, siSlotKey, siTier, type SiAnalytics, type SiBranchRow, type SiEmployeeRow, type SiRankMetric, type SiTier,
} from "@jewelos/core";
import { Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { BreakdownList, dailyPoints, dayLabel, Figure, Heatmap, incompleteNote, Scatter, scoreText, useDrill, type DrillTarget } from "./analyticsUi";
import { BarChart, LineChart } from "./charts";
import { siPath } from "./routes";
import { Disclosure, Panel } from "./ui";

const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const label = <K extends string>(map: Readonly<Record<K, string>>, key: string) => (key in map ? map[key as K] : key); // Unknown keys print as sent.

/** A table cell that opens the conversations behind it. */
function DrillCell({ value, target, className }: { value: string | number; target: DrillTarget; className?: string }) {
  const api = useDrill();
  return <td className={cn("py-2 pr-2 text-right tabular-nums", className)}>
    <button className="rounded px-1 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold" onClick={() => api.open({ title: target.title, metric: target.metric, filters: { ...api.base, ...target.filters } })} type="button">{value}</button>
  </td>;
}
function More({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Disclosure onToggle={setOpen} open={open} summary={title}>{children}</Disclosure>;
}

// ---------------------------------------------------------------------------------------------
export function SalesAnalytics({ data }: { data: SiAnalytics }) {
  const c = data.current; const min = data.meta.min_sample; const f = c.funnel;
  const api = useDrill();
  const stages: [string, number, number | null, DrillTarget][] = [
    ["Engaged", f.engaged, null, { title: "Engaged", metric: "funnel:engaged" }],
    ["Interest", f.interest, f.engaged, { title: "Interest", metric: "funnel:interest" }],
    ["Price discussed", f.price, f.interest, { title: "Price discussed", metric: "funnel:price" }],
  ];
  const opportunity = siOpportunity(c.at_risk, c.crm.confirmed, c.crm.eligible, data.meta.ticket_inr, min);
  return <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel><BarChart points={dailyPoints(data, (d) => d?.sessions ?? 0)} title="Conversations per day" valueLabel="Conversations" /></Panel>
      <Panel><BarChart points={dailyPoints(data, (d) => d?.confirmed ?? 0)} title="CRM-confirmed conversions per day (by conversation date)" valueLabel="Confirmed" /></Panel>
    </div>
    <Panel description="Stages count only when the AI's reading cites transcript evidence. Drop-off = previous stage − this stage." title="Conversation stages">
      <table className="w-full text-sm">
        <caption className="sr-only">Conversation stages with counts and drop-off</caption>
        <thead><tr className="text-left text-xs text-task-text-muted"><th className="py-2 pr-2 font-semibold" scope="col">Stage</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Conversations</th>
          <th className="py-2 pr-2 text-right font-semibold" scope="col">Of previous</th><th className="py-2 text-right font-semibold" scope="col">Dropped</th></tr></thead>
        <tbody>
          {stages.map(([name, value, previous, target]) => <tr className="border-t border-task-border" key={name}><th className="py-2 pr-2 text-left font-normal" scope="row">{name}</th>
            <DrillCell target={target} value={value} /><td className="py-2 pr-2 text-right tabular-nums">{previous === null ? `of ${c.analysed} analysed` : siRateText(siRate(value, previous))}</td>
            <td className="py-2 text-right tabular-nums">{previous === null ? "—" : previous - value}</td></tr>)}
          <tr className="border-t border-task-border"><th className="py-2 pr-2 text-left font-normal" scope="row">Confirmed converted</th>
            <DrillCell target={{ title: "Confirmed converted (engaged)", metric: "funnel:confirmed" }} value={f.confirmed} />
            <td className="py-2 pr-2 text-right tabular-nums">{siRateText(siRate(f.confirmed, f.engaged_eligible, min))} of {f.engaged_eligible} CRM-checked</td><td className="py-2 text-right">—</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-xs text-task-text-muted">{SI_DEFINITIONS.funnel_confirmed.meaning} {incompleteNote(data) ?? ""}</p>
    </Panel>
    <Panel description="When customers came in (India time). Tap a cell for those conversations." title="Visits by day and hour">
      <Heatmap onSelect={(dow, hour) => api.open({ title: `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow - 1]} ${hour}:00`, metric: siSlotKey(dow, hour), filters: api.base })} slots={data.by_slot} />
      <p className="mt-2 text-xs text-task-text-muted">Staffing comparison is not shown: rostered hours are not connected to recordings, so visits per person on duty cannot be calculated honestly.</p>
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel description="Conversations mentioning each product (words as said)." title="Top product requests">
        <BreakdownList empty="No products mentioned yet." items={data.products.map((p) => ({ key: p.text, label: p.text, value: p.sessions, detail: `${p.confirmed ?? 0} confirmed`, drill: { title: `“${p.text}”`, metric: `product:${p.text}` } }))} label="Top product requests" />
      </Panel>
      <Panel description={`Confirmed ÷ CRM-checked, shown from ${min} CRM-checked conversations.`} title="Conversion by product type">
        <BreakdownTable rows={data.categories.map((r) => ({ ...r, label: label(SI_CATEGORY_LABEL, r.key), metric: `category:${r.key}` }))} min={min} empty="No product types recognised yet." />
      </Panel>
    </div>
    {data.by_branch.length > 1 ? <Panel title="Branches compared"><BranchTable rows={data.by_branch} min={min} /></Panel> : null}
    <Panel title="Revenue">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-task-text">Verified revenue</dt><dd className="text-task-text-muted">Not available: the CRM does not record sale amounts.</dd></div>
        <div><dt className="font-semibold text-task-text">Estimated revenue (not verified)</dt><dd className="text-task-text-muted">{data.meta.ticket_inr === null ? "No estimate: an administrator can set an average ticket in Settings." : <><span className="font-semibold text-task-text">{inr(c.crm.confirmed * data.meta.ticket_inr)}</span> = {c.crm.confirmed} confirmed × {inr(data.meta.ticket_inr)} average ticket</>}</dd></div>
        <div className="sm:col-span-2"><dt className="font-semibold text-task-text">Opportunity at risk (hypothetical benchmark)</dt><dd className="text-task-text-muted">{opportunityText(opportunity, c.at_risk, data.meta.ticket_inr)}</dd></div>
      </dl>
    </Panel>
  </div>;
}
function opportunityText(o: ReturnType<typeof siOpportunity>, atRisk: number, ticket: number | null): string {
  if (o.state === "none") return "No interested customer without a CRM purchase in this period.";
  if (o.state === "no_ticket") return `${atRisk} interested customers have no CRM purchase. Set an average ticket to see a hypothetical value.`;
  if (o.state === "insufficient") return `${atRisk} interested customers have no CRM purchase. Too few CRM-checked conversations to estimate a rate.`;
  return `${inr(o.value ?? 0)} = ${atRisk} interested, no purchase × ${o.rate}% confirmed rate × ${inr(ticket ?? 0)}. Assumes they would convert at this period's own rate; not a forecast or a loss. Formula: ${o.formula}.`;
}

function BreakdownTable({ rows, min, empty }: { rows: readonly Readonly<{ key: string; label: string; sessions: number; eligible: number; confirmed: number; metric: string }>[]; min: number; empty: string }) {
  if (!rows.length) return <p className="text-sm text-task-text-muted">{empty}</p>;
  return <table className="w-full text-sm">
    <thead><tr className="text-left text-xs text-task-text-muted"><th className="py-2 pr-2 font-semibold" scope="col">Type</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Conversations</th>
      <th className="py-2 pr-2 text-right font-semibold" scope="col">CRM-checked</th><th className="py-2 text-right font-semibold" scope="col">Confirmed</th></tr></thead>
    <tbody>{rows.map((r) => <tr className="border-t border-task-border" key={r.key}><th className="py-2 pr-2 text-left font-normal" scope="row">{r.label}</th>
      <DrillCell target={{ title: r.label, metric: r.metric }} value={r.sessions} /><td className="py-2 pr-2 text-right tabular-nums">{r.eligible}</td>
      <td className="py-2 text-right tabular-nums">{r.confirmed} · {siRateText(siRate(r.confirmed, r.eligible, min))}</td></tr>)}</tbody>
  </table>;
}

function BranchTable({ rows, min }: { rows: readonly SiBranchRow[]; min: number }) {
  return <div className="scroll-x -mx-1 px-1"><table className="w-full min-w-[34rem] text-sm">
    <thead><tr className="text-left text-xs text-task-text-muted"><th className="py-2 pr-2 font-semibold" scope="col">Branch</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Conversations</th>
      <th className="py-2 pr-2 text-right font-semibold" scope="col">Avg score (N)</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Confirmed conversion</th><th className="py-2 text-right font-semibold" scope="col">Score change</th></tr></thead>
    <tbody>{rows.map((b) => <tr className="border-t border-task-border" key={b.branch_id}><th className="py-2 pr-2 text-left font-normal" scope="row">{b.branch_name}</th>
      <DrillCell target={{ title: `${b.branch_name}: conversations`, metric: "sessions", filters: { branch_ids: [b.branch_id] } }} value={b.sessions} />
      <td className="py-2 pr-2 text-right tabular-nums">{b.scored >= min ? scoreText(b.average_score) : "Too few"} ({b.scored})</td>
      <td className="py-2 pr-2 text-right tabular-nums">{siRateText(siRate(b.confirmed, b.eligible, min))} ({b.eligible})</td>
      <td className="py-2 text-right text-xs">{b.scored >= min && b.prior_scored >= min ? siChange(b.average_score, b.prior_average_score, "points").text : "Too few to compare"}</td></tr>)}</tbody>
  </table></div>;
}

// ---------------------------------------------------------------------------------------------
export function CoachingAnalytics({ data, navigate }: { data: SiAnalytics; navigate: (path: string) => void }) {
  const c = data.current; const p = data.prior; const min = data.meta.min_sample;
  const [dimension, setDimension] = useState(data.dimensions[0]?.key ?? "");
  const tiers = data.by_employee.filter((e) => e.sessions > 0).reduce<Record<SiTier, number>>((acc, e) => { acc[siTier(e, min)] += 1; return acc; }, { strong: 0, good: 0, needs_work: 0, insufficient: 0 });
  const weeks = data.dimension_weeks.filter((w) => w.key === dimension);
  const names = new Map(data.by_employee.map((e) => [e.employee_id, e.employee_name]));
  const points = data.correlation.employees.points.map((pt) => ({ key: pt.employee_id, label: names.get(pt.employee_id) ?? "Unknown", x: Math.round(pt.average_score), y: pt.conversion_rate, n: `${pt.scored} scored, ${pt.eligible} CRM-checked` }));
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure change={c.scored >= min && p.scored >= min ? siChange(c.average_score, p.average_score, "points") : null} definition={SI_DEFINITIONS.average_score} sample={`N = ${c.scored} scored`} value={c.scored >= min ? scoreText(c.average_score) : c.scored ? "Too few" : "—"} />
      <Figure definition={SI_DEFINITIONS.unreviewed} value={c.unreviewed} />
      <Figure definition={SI_DEFINITIONS.flagged} value={c.flagged} />
      <Figure definition={SI_DEFINITIONS.unscored} sample={`of ${c.analysed} analysed`} value={c.unscored} />
    </div>
    <Panel description="Average rating out of 10 per scored area; lowest first. Change is against the prior period." title="Areas needing coaching">
      {data.dimensions.length ? <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-task-text-muted"><th className="py-2 pr-2 font-semibold" scope="col">Area</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Average (N)</th><th className="py-2 text-right font-semibold" scope="col">Change</th></tr></thead>
        <tbody>{data.dimensions.map((d) => <tr className="border-t border-task-border" key={d.key}><th className="py-2 pr-2 text-left font-normal" scope="row">{d.label}</th>
          <DrillCell target={{ title: d.label, metric: `dimension:${d.key}` }} value={`${d.average}/10 (${d.assessed})`} />
          <td className="py-2 text-right text-xs">{d.assessed >= min && d.prior_assessed >= min ? siChange(d.average, d.prior_average, "points").text : "Too few to compare"}</td></tr>)}</tbody>
      </table> : <p className="text-sm text-task-text-muted">Areas appear once conversations are scored.</p>}
    </Panel>
    {data.dimensions.length ? <Panel title="Area trend by week">
      <label className="mb-3 block max-w-xs"><span className="label">Area</span><select className="field" onChange={(e) => setDimension(e.target.value)} value={dimension}>{data.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label>
      <LineChart format={(v) => `${v.toFixed(1)}/10`} max={10} points={weeks.map((w) => ({ key: w.week, label: `Week of ${dayLabel(w.week)} (${w.assessed})`, value: w.average }))} title="Average rating per week (0–10)" valueLabel="Average rating" />
    </Panel> : null}
    <Panel description={`Tiers need at least ${min} scored conversations.`} title="Performance tiers">
      <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{(Object.keys(tiers) as SiTier[]).map((t) => <li className="rounded-lg border border-task-border p-2" key={t}><span className="block text-xs text-task-text-muted">{SI_TIER_LABEL[t]}</span><span className="text-lg font-semibold tabular-nums">{tiers[t]}</span></li>)}</ul>
      <PeopleTable min={min} rows={data.by_employee} />
    </Panel>
    <Panel description="One dot per person with enough scored and CRM-checked conversations." title="Score vs confirmed conversion">
      <p className="mb-2 text-sm text-task-text">{siCorrelationText(data.correlation.employees.r, data.correlation.employees.n, min)}</p>
      <p className="mb-2 text-xs text-task-text-muted">Per conversation: {siCorrelationText(data.correlation.sessions.r, data.correlation.sessions.n, min)}</p>
      <Scatter caption="People: average score vs confirmed conversion" points={points} />
    </Panel>
    <Panel description="Strengths the AI cited in conversations scoring 80 or more. The Coaching tab lists the strongest examples to share." title="What good looks like">
      <BreakdownList empty="No strong, scored conversations in this period." items={data.mentions.strengths.map((m) => ({ key: m.text, label: m.text, value: m.sessions, drill: { title: "Strong conversations", metric: "scored" } }))} label="Strengths" />
      <a className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-gold-secondary hover:underline" href={siPath.coaching()} onClick={(e) => { e.preventDefault(); navigate(siPath.coaching()); }}>Open Coaching (review queue and strongest examples)</a>
    </Panel>
  </div>;
}

function PeopleTable({ rows, min }: { rows: readonly SiEmployeeRow[]; min: number }) {
  const active = rows.filter((r) => r.sessions > 0);
  if (!active.length) return null;
  return <div className="scroll-x -mx-1 mt-3 px-1"><table className="w-full min-w-[32rem] text-sm">
    <thead><tr className="text-left text-xs text-task-text-muted"><th className="py-2 pr-2 font-semibold" scope="col">Person</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Avg (N)</th>
      <th className="py-2 pr-2 font-semibold" scope="col">Tier</th><th className="py-2 pr-2 font-semibold" scope="col">Work on</th><th className="py-2 text-right font-semibold" scope="col">Change</th></tr></thead>
    <tbody>{active.map((e) => <tr className="border-t border-task-border" key={e.employee_id}><th className="py-2 pr-2 text-left font-normal" scope="row">{e.employee_name}</th>
      <DrillCell target={{ title: `${e.employee_name}: scored`, metric: "scored", filters: { employee_ids: [e.employee_id] } }} value={`${scoreText(e.average_score)} (${e.scored})`} />
      <td className="py-2 pr-2 text-xs">{SI_TIER_LABEL[siTier(e, min)]}</td><td className="py-2 pr-2 text-xs">{e.focus ?? "—"}</td>
      <td className="py-2 text-right text-xs">{e.scored >= min && e.prior_scored >= min ? siChange(e.average_score, e.prior_average_score, "points").text : "Too few"}</td></tr>)}</tbody>
  </table></div>;
}

// ---------------------------------------------------------------------------------------------
export function CustomerAnalytics({ data }: { data: SiAnalytics }) {
  const c = data.current; const min = data.meta.min_sample;
  const signal = (key: string) => ({ key, label: SI_SIGNAL_LABEL[key] ?? key, value: data.signals[key] ?? 0, detail: `of ${c.analysed}`, drill: { title: SI_SIGNAL_LABEL[key] ?? key, metric: `signal:${key}` } });
  const bands = SI_PRICE_BANDS.map((key) => ({ key, label: SI_PRICE_BAND_LABEL[key], value: data.price_bands.find((b) => b.key === key)?.sessions ?? 0, drill: { title: SI_PRICE_BAND_LABEL[key], metric: `price_band:${key}` } })).filter((b) => b.value > 0);
  return <div className="space-y-4">
    <p className="text-xs text-task-text-muted">Counts are conversations (each once), out of {c.analysed} analysed. {incompleteNote(data) ?? ""}</p>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Product type"><BreakdownTable empty="No product types recognised yet." min={min} rows={data.categories.map((r) => ({ ...r, label: label(SI_CATEGORY_LABEL, r.key), metric: `category:${r.key}` }))} /></Panel>
      <Panel title="Metal and design"><BreakdownTable empty="No metal or design words recognised yet." min={min} rows={data.elements.map((r) => ({ ...r, label: label(SI_ELEMENT_LABEL, r.key), metric: `element:${r.key}` }))} /></Panel>
      <Panel description="From the budget the customer stated, with evidence." title="Price band"><BreakdownList empty="No budgets stated." items={bands} label="Price bands" /></Panel>
      <Panel title="What came up"><BreakdownList empty="Nothing analysed yet." items={["customer_questions", "price_concern", "objection", "stock_gap", "competitor_mention", "upsell_opportunity", "drop_off"].map(signal)} label="Signals" /></Panel>
      <Panel description="Concerns and reasons not to buy, grouped by the words used." title="Objections">
        <BreakdownList empty="No concerns recorded." items={data.mentions.concerns.map((m) => ({ key: m.text, label: m.text, value: m.sessions, drill: { title: `“${m.text}”`, metric: `concern:${m.text}` } }))} label="Objections" />
      </Panel>
      <Panel title="Other stores mentioned">
        <BreakdownList empty="No other stores mentioned." items={data.mentions.competitors.map((m) => ({ key: m.text, label: m.text, value: m.sessions, drill: { title: `“${m.text}”`, metric: `competitor:${m.text}` } }))} label="Competitors" />
      </Panel>
    </div>
    <Notice tone="task">Age, gender, religion, community and other personal traits are never inferred from recordings. Customer preferences given with consent are kept in the CRM, which does not share them with recordings, so demographics are not shown here.</Notice>
  </div>;
}

// ---------------------------------------------------------------------------------------------
export function LeadershipAnalytics({ data }: { data: SiAnalytics }) {
  const c = data.current; const p = data.prior; const min = data.meta.min_sample;
  const actions = siBranchActions(data.by_branch, c, min);
  const api = useDrill();
  const q = data.quality;
  const conversion = siRate(c.crm.confirmed, c.crm.eligible, min); const prior = siRate(p.crm.confirmed, p.crm.eligible, min);
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure change={siChange(c.sessions, p.sessions, "count")} definition={SI_DEFINITIONS.sessions} sample={`${c.branches} branches, ${c.employees} people`} value={c.sessions} />
      <Figure change={c.scored >= min && p.scored >= min ? siChange(c.average_score, p.average_score, "points") : null} definition={SI_DEFINITIONS.average_score} sample={`N = ${c.scored}`} value={c.scored >= min ? scoreText(c.average_score) : "Too few"} />
      <Figure change={conversion.state === "ok" && prior.state === "ok" ? siChange(conversion.value, prior.value, "rate") : null} definition={SI_DEFINITIONS.conversion_rate} sample={`${c.crm.confirmed} of ${c.crm.eligible}`} value={siRateText(conversion)} />
      <Figure definition={SI_DEFINITIONS.at_risk} sample={data.meta.ticket_inr === null ? "No ticket set" : undefined} value={c.at_risk} />
    </div>
    <Panel description="Rules, most urgent first. Tap one for the conversations behind it." title="Branch priorities">
      {actions.length ? <ol className="space-y-2">{actions.map((a, i) => <li key={`${a.branch_id}-${a.metric}-${i}`}>
        <button className="block w-full rounded-lg border border-task-border p-3 text-left hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold" onClick={() => api.open({ title: `${a.branch_name}: ${a.title}`, metric: a.metric, filters: { ...api.base, branch_ids: [a.branch_id] } })} type="button">
          <span className="text-xs font-semibold text-task-text-muted">{a.priority === 1 ? "Now" : a.priority === 2 ? "This week" : "When you can"} · {a.branch_name}</span>
          <span className="block text-sm font-semibold text-task-text">{a.title}</span><span className="block text-xs text-task-text-muted">{a.detail}</span>
        </button></li>)}</ol> : <p className="text-sm text-task-text-muted">Nothing needs attention by these rules.</p>}
    </Panel>
    <Panel description="Score change is the demonstrated coaching trend: same people and branch, this period vs the one before." title="Branches"><BranchTable min={min} rows={data.by_branch} /></Panel>
    <Panel title="Opportunity at risk (hypothetical)"><p className="text-sm text-task-text-muted">{opportunityText(siOpportunity(c.at_risk, c.crm.confirmed, c.crm.eligible, data.meta.ticket_inr, min), c.at_risk, data.meta.ticket_inr)}</p></Panel>
    <More title="Data quality">
      <ul className="divide-y divide-task-border text-sm">{([["Removed after retention", c.retention_removed], ["No summary yet", c.not_analysed], ["Recording interrupted", c.interrupted], ["Audio hard to hear", q.low_audio],
        ["Could not tell speakers apart", q.speakers_unverified], ["Too little speech", q.too_little_speech], ["Backup reviewer used", q.backup_model], ["No customer linked (CRM outcome unknown)", c.crm.not_linked]] as const)
        .map(([name, n]) => <li className="flex justify-between gap-3 py-2" key={name}><span>{name}</span><span className="tabular-nums text-task-text-muted">{n} {c.sessions ? `(${siRateText(siRate(n, c.sessions))})` : ""}</span></li>)}</ul>
    </More>
  </div>;
}

// ---------------------------------------------------------------------------------------------
export function RankingsAnalytics({ data }: { data: SiAnalytics }) {
  const [who, setWho] = useState<"people" | "branches">("people");
  const [metric, setMetric] = useState<SiRankMetric>("conversion");
  const min = data.meta.min_sample;
  const rows = who === "people" ? data.by_employee.filter((e) => e.sessions > 0) : data.by_branch;
  const { ranked, unranked } = siRank<SiEmployeeRow | SiBranchRow>(rows, metric, min);
  const nameOf = (r: SiEmployeeRow | SiBranchRow) => ("employee_name" in r ? r.employee_name : r.branch_name);
  const filterOf = (r: SiEmployeeRow | SiBranchRow) => ("employee_id" in r ? { employee_ids: [r.employee_id] } : { branch_ids: [r.branch_id] });
  const keyOf = (r: SiEmployeeRow | SiBranchRow) => ("employee_id" in r ? r.employee_id : r.branch_id);
  const value = (m: SiRankMetric, v: number) => (m === "conversion" ? `${v}%` : m === "score" ? String(Math.round(v)) : String(v));
  const trend = (r: SiEmployeeRow | SiBranchRow) => metric === "volume" ? siChange(r.sessions, r.prior_sessions, "count").text
    : metric === "score" ? (r.prior_scored >= min ? siChange(r.average_score, r.prior_average_score, "points").text : "No comparable prior")
    : (() => { const now = siRate(r.confirmed, r.eligible, min); const before = siRate(r.prior_confirmed, r.prior_eligible, min); return now.state === "ok" && before.state === "ok" ? siChange(now.value, before.value, "rate").text : "No comparable prior"; })();
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-3">
      <label className="block"><span className="label">Rank</span><select className="field" onChange={(e) => setWho(e.target.value === "branches" ? "branches" : "people")} value={who}><option value="people">Salespeople</option><option value="branches">Branches</option></select></label>
      <label className="block"><span className="label">By</span><select className="field" onChange={(e) => setMetric((["conversion", "score", "volume"] as const).find((m) => m === e.target.value) ?? "conversion")} value={metric}>
        {(["conversion", "score", "volume"] as const).map((m) => <option key={m} value={m}>{SI_RANK_METRIC_LABEL[m]}</option>)}</select></label>
    </div>
    <Panel>
      {ranked.length ? <div className="scroll-x -mx-1 px-1"><table className="w-full min-w-[30rem] text-sm">
        <caption className="sr-only">{who === "people" ? "Salespeople" : "Branches"} ranked by {SI_RANK_METRIC_LABEL[metric]}</caption>
        <thead><tr className="text-left text-xs text-task-text-muted"><th className="py-2 pr-2 font-semibold" scope="col">#</th><th className="py-2 pr-2 font-semibold" scope="col">{who === "people" ? "Salesperson" : "Branch"}</th>
          <th className="py-2 pr-2 text-right font-semibold" scope="col">{SI_RANK_METRIC_LABEL[metric]}</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Sample</th><th className="py-2 text-right font-semibold" scope="col">vs prior</th></tr></thead>
        <tbody>{ranked.map((r) => <tr className="border-t border-task-border" key={keyOf(r.row)}>
          <td className="py-2 pr-2 tabular-nums text-task-text-muted">{r.rank}</td><th className="py-2 pr-2 text-left font-semibold" scope="row">{nameOf(r.row)}</th>
          <DrillCell target={{ title: `${nameOf(r.row)}: ${SI_RANK_METRIC_LABEL[metric]}`, metric: metric === "conversion" ? "crm:eligible" : metric === "score" ? "scored" : "sessions", filters: filterOf(r.row) }} value={value(metric, r.value)} />
          <td className="py-2 pr-2 text-right text-xs tabular-nums text-task-text-muted">{metric === "conversion" ? `${r.row.confirmed} of ${r.sample}` : metric === "score" ? `${r.sample} scored` : `${r.row.scored} scored`}</td>
          <td className="py-2 text-right text-xs">{trend(r.row)}</td></tr>)}</tbody>
      </table></div> : <p className="text-sm text-task-text-muted">No one has enough {metric === "score" ? "scored" : "CRM-checked"} conversations to rank yet.</p>}
      {unranked.length ? <p className="mt-3 text-xs text-task-text-muted">Not ranked ({unranked.length}): {unranked.map(nameOf).join(", ")}. {metric === "volume" ? "No conversations." : `Fewer than ${min} ${metric === "score" ? "scored" : "CRM-checked"} conversations is too few to compare fairly.`}</p> : null}
    </Panel>
    <Notice tone="task">Rankings help find who to learn from and who needs support. Conversion counts only CRM-confirmed purchases; a customer who was never linked is unknown, not a loss.</Notice>
  </div>;
}
