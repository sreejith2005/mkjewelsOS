import { useMemo, useState, type ReactNode } from "react";
import { formatRecordedTotal, istDateRange, OUTCOME_LABEL, RANKING_MIN_SCORED, SALES_OUTCOMES, share, type CrmInsights, type Insights } from "@jewelos/core";
import { fetchInsights } from "@jewelos/data";
import { Notice } from "@/components/ui";
import { BarChart, LineChart, RankedBars } from "./charts";
import { RangePicker } from "./CoachingView";
import { siPath, type InsightView, type RangeDays } from "./routes";
import { Disclosure, EmptyState, ErrorState, Panel, SkeletonRows, Stat, TabBar } from "./ui";
import { useLoad } from "./useLoad";

const VIEWS: readonly { id: InsightView; label: string }[] = [
  { id: "sales", label: "Sales & Demand" }, { id: "coaching", label: "Coaching" }, { id: "customers", label: "Customer Insights" },
  { id: "leadership", label: "Leadership" }, { id: "rankings", label: "Rankings" },
];
const pct = (value: number | null) => (value === null ? "—" : `${value}%`);
const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** Every day in the range, so quiet days show as zero instead of disappearing. */
function daily(insights: Insights, pick: (day: Insights["by_day"][number] | undefined) => number | null) {
  const byDate = new Map(insights.by_day.map((day) => [day.date, day]));
  const points = []; const start = Date.parse(`${insights.range.from}T00:00:00Z`); const end = Date.parse(`${insights.range.to}T00:00:00Z`);
  for (let t = start; t <= end; t += 86_400_000) { const key = new Date(t).toISOString().slice(0, 10); points.push({ key, label: dayLabel(key), value: pick(byDate.get(key)) }); }
  return points;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Disclosure onToggle={setOpen} open={open} summary={title}>{children}</Disclosure>;
}
function Definitions({ items }: { items: readonly [string, string][] }) {
  return <Section title="How these are counted"><dl className="space-y-2 text-sm">{items.map(([term, meaning]) => <div key={term}><dt className="font-semibold text-task-text">{term}</dt><dd className="text-task-text-muted">{meaning}</dd></div>)}</dl></Section>;
}

export function InsightsView({ navigate, view, range }: { navigate: (path: string) => void; view: InsightView; range: RangeDays }) {
  const { from, to } = istDateRange(range);
  const insights = useLoad(() => fetchInsights(from, to), [from, to]);
  const data = insights.data;
  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold text-task-text">Insights</h1><p className="mt-0.5 text-sm text-task-text-muted">Your branch, last {range} days.</p></div>
      <RangePicker onChange={(days) => navigate(siPath.insights(view, days))} value={range} />
    </header>
    <TabBar current={view} items={VIEWS.map((item) => ({ ...item, href: siPath.insights(item.id, range) }))} label="Insight views" onSelect={(id) => navigate(siPath.insights(id, range))} />
    {insights.error && !data ? <ErrorState message={insights.error} onRetry={insights.reload} />
      : !data ? <SkeletonRows label="Loading insights" rows={3} />
      : !data.totals.conversations ? <EmptyState title="No conversations in this period">Try a longer period, or check Devices to see whether recorders are in use.</EmptyState>
      : view === "sales" ? <SalesView data={data} />
      : view === "coaching" ? <CoachingInsights data={data} />
      : view === "customers" ? <CustomerView data={data} />
      : view === "leadership" ? <LeadershipView data={data} />
      : <RankingsView data={data} />}
  </div>;
}

function SalesView({ data }: { data: Insights }) {
  const analysed = data.totals.analysed;
  const points = useMemo(() => daily(data, (day) => day?.conversations ?? 0), [data]);
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Conversations" value={data.totals.conversations} />
      <Stat label="Time recorded" value={formatRecordedTotal(data.totals.recorded_ms)} />
      <Stat hint={`of ${analysed} with a summary`} label="Purchase mentioned" value={pct(share(data.outcomes.reported_purchase, analysed))} />
      <Stat hint={`of ${analysed} with a summary`} label="Follow-up agreed" value={pct(share(data.outcomes.follow_up, analysed))} />
    </div>
    {data.crm ? <CrmResults crm={data.crm} /> : null}
    <Panel><BarChart points={points} title="Conversations per day" valueLabel="Conversations" /></Panel>
    <Section title="Busiest hours">
      <BarChart format={(value) => String(value)} points={Array.from({ length: 13 }, (_, i) => i + 9).map((hour) => ({ key: String(hour), label: `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`, value: data.by_hour.find((h) => h.hour === hour)?.conversations ?? 0 }))} title="Conversations by hour (9am–9pm)" valueLabel="Conversations" />
    </Section>
    <Section title="What customers said happened">
      <RankedBars items={SALES_OUTCOMES.map((outcome) => ({ label: OUTCOME_LABEL[outcome], value: data.outcomes[outcome] }))} label="Outcomes" />
    </Section>
    <Definitions items={[["Purchase mentioned", "The customer or salesperson said a purchase was made. It is not a CRM-confirmed sale."], ["Follow-up agreed", "A concrete next step was agreed in the conversation."], ["Time recorded", "Saved audio only, including partly saved conversations."]]} />
  </div>;
}

function CoachingInsights({ data }: { data: Insights }) {
  const points = useMemo(() => daily(data, (day) => day?.average_score ?? null), [data]);
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Average score" value={data.totals.average_score === null ? "—" : Math.round(data.totals.average_score)} hint={data.totals.scored ? `${data.totals.scored} scored` : "Nothing scored yet"} />
      <Stat label="Scored" value={pct(share(data.totals.scored, data.totals.conversations))} hint="of all conversations" />
      <Stat label="Waiting for review" value={data.totals.unreviewed} />
      <Stat label="Flagged" value={data.totals.flagged} />
    </div>
    <Panel><LineChart format={(value) => String(Math.round(value))} points={points} title="Average score by day" valueLabel="Average score" /></Panel>
    <Section title="Scores by area">
      {data.dimensions.length ? <RankedBars format={(value) => `${value}/10`} scaleMax={10} items={data.dimensions.map((d) => ({ label: d.label, value: d.average }))} label="Average rating by area" /> : <p className="text-sm text-task-text-muted">No scored areas yet.</p>}
    </Section>
    <Definitions items={[["Average score", "MK Sales Score, using the manager's score where a manager edited it."], ["Scored", "Conversations with enough speech to judge fairly. Short or unclear ones are not scored."]]} />
  </div>;
}

function CustomerView({ data }: { data: Insights }) {
  const s = (key: string) => data.signals[key] ?? 0;
  const list = (items: readonly { text: string; count: number }[], empty: string) => items.length ? <RankedBars items={items.map((item) => ({ label: item.text, value: item.count }))} label="Mentions" /> : <p className="text-sm text-task-text-muted">{empty}</p>;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Price concerns" value={s("price_concern")} /><Stat label="Item not in stock" value={s("stock_gap")} />
      <Stat label="Other stores mentioned" value={s("competitor_mention")} /><Stat label="Objections" value={s("objection")} />
    </div>
    <Panel title="What customers asked about">{list(data.top_mentions.products, "No products mentioned yet.")}</Panel>
    <Section title="Concerns and reasons not to buy">{list(data.top_mentions.concerns, "No concerns recorded.")}</Section>
    <Section title="Other stores mentioned">{list(data.top_mentions.competitors, "No other stores mentioned.")}</Section>
    <Definitions items={[["Mentions", "Grouped by the exact words used, so similar items may appear separately."], ["Counts", "Number of conversations where it came up, from conversations with a summary."]]} />
  </div>;
}

const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
/** What the AI heard next to what the CRM confirms; each CRM purchase visit counts once. */
function CrmResults({ crm }: { crm: CrmInsights }) {
  const r = crm.revenue;
  return <Panel description={`Purchases come from the CRM's verified purchase rule, within ${crm.window_days} days of the conversation.`} title="AI-suggested vs CRM-confirmed">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat hint="from what was said" label="Converted (AI-suggested)" value={crm.ai_suggested.converted} />
      <Stat hint="each purchase once" label="Confirmed in CRM" value={crm.crm.confirmed_purchases} />
      <Stat hint="no linked, confirmed customer" label="Pending CRM confirmation" value={crm.crm.pending_confirmation} />
      <Stat hint="AI said converted, CRM shows no purchase" label="Not confirmed yet" value={crm.crm.ai_converted_not_confirmed} />
    </div>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="font-semibold text-task-text">Revenue realised</dt><dd className="text-task-text-muted">{r.verified === null ? r.verified_note || "Not recorded in the CRM." : inr(r.verified)}</dd></div>
      <div><dt className="font-semibold text-task-text">Estimated revenue</dt><dd className="text-task-text-muted">{r.estimated === null ? "No estimate: set an average ticket in Settings to see one." : <><span className="font-semibold text-task-text">Estimated {inr(r.estimated)}</span> = {crm.crm.confirmed_purchases} confirmed × {inr(r.ticket_inr ?? 0)} average ticket</>}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-task-text-muted">{r.formula}. Repairs, exchanges, returns, price checks, order pickups and follow-ups are never counted as new sales unless the CRM's rule says so. Repeat conversations about one purchase count it once, credited to the latest conversation before it.</p>
  </Panel>;
}

function LeadershipView({ data }: { data: Insights }) {
  const q = data.quality; const total = data.totals.conversations;
  const issues: [string, number][] = [["Not yet summarised", q.not_analysed], ["Recording interrupted", q.interrupted], ["Audio hard to hear", q.low_audio], ["Could not tell speakers apart", q.speakers_unverified], ["Too little speech", q.too_little_speech], ["Backup reviewer used", q.backup_model]];
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Conversations" value={total} hint={`${data.totals.employees} salespeople`} />
      <Stat label="Average score" value={data.totals.average_score === null ? "—" : Math.round(data.totals.average_score)} />
      <Stat label="Reviews approved" value={pct(share(data.totals.approved, data.totals.analysed))} hint="of summarised" />
      <Stat label="Follow-ups done" value={pct(share(data.follow_ups.completed, data.follow_ups.created))} hint={`${data.follow_ups.created} created`} />
    </div>
    {!data.crm_outcomes_connected ? <Notice tone="task">CRM-confirmed purchases are not connected to recordings yet. Outcomes here come from what was said and are signals, not sales figures.</Notice>
      : <Notice tone="task">“Purchase mentioned” and AI-suggested outcomes come from what was said. Only “Confirmed in CRM” counts verified purchases.</Notice>}
    <Panel description="Things that make these numbers less reliable." title="Data quality">
      <ul className="divide-y divide-task-border text-sm">{issues.map(([label, count]) => <li className="flex justify-between gap-3 py-2" key={label}><span className="text-task-text">{label}</span><span className="tabular-nums text-task-text-muted">{count} {count ? `(${share(count, total)}%)` : ""}</span></li>)}</ul>
    </Panel>
    <Definitions items={[["Reviews approved", "Share of summarised conversations a manager approved or edited."], ["Follow-ups done", "Tasks created from suggested next actions that are now complete."]]} />
  </div>;
}

type Metric = "average_score" | "conversations" | "reported_purchase";
function RankingsView({ data }: { data: Insights }) {
  const [metric, setMetric] = useState<Metric>("average_score");
  const eligible = data.by_employee.filter((person) => metric !== "average_score" || person.scored >= RANKING_MIN_SCORED);
  const ranked = [...eligible].sort((a, b) => (b[metric] ?? -1) - (a[metric] ?? -1));
  const left = data.by_employee.length - eligible.length;
  return <div className="space-y-4">
    <label className="block max-w-xs"><span className="label">Rank by</span>
      <select className="field" onChange={(event) => setMetric(event.target.value as Metric)} value={metric}>
        <option value="average_score">Average score</option><option value="conversations">Conversations</option><option value="reported_purchase">Purchase mentioned</option></select></label>
    <Panel>
      {ranked.length ? <table className="w-full text-sm">
        <caption className="sr-only">Salespeople ranked by {metric === "average_score" ? "average score" : metric === "conversations" ? "conversations" : "purchase mentioned"}</caption>
        <thead><tr className="text-left text-xs text-task-text-muted"><th className="py-2 pr-2 font-semibold" scope="col">#</th><th className="py-2 pr-2 font-semibold" scope="col">Salesperson</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Score</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Conversations</th><th className="hidden py-2 text-right font-semibold sm:table-cell" scope="col">Purchase mentioned</th></tr></thead>
        <tbody>{ranked.map((person, index) => <tr className="border-t border-task-border" key={person.employee_id}>
          <td className="py-2.5 pr-2 tabular-nums text-task-text-muted">{index + 1}</td><th className="py-2.5 pr-2 text-left font-semibold text-task-text" scope="row">{person.employee_name}</th>
          <td className="py-2.5 pr-2 text-right tabular-nums text-task-text">{person.average_score === null ? "—" : Math.round(person.average_score)}</td>
          <td className="py-2.5 pr-2 text-right tabular-nums text-task-text">{person.conversations}</td>
          <td className="hidden py-2.5 text-right tabular-nums text-task-text sm:table-cell">{person.reported_purchase}</td></tr>)}</tbody>
      </table> : <p className="text-sm text-task-text-muted">No one has enough scored conversations to rank yet.</p>}
      {metric === "average_score" && left > 0 ? <p className="mt-3 text-xs text-task-text-muted">{left} {left === 1 ? "person is" : "people are"} not ranked: fewer than {RANKING_MIN_SCORED} scored conversations is too few to compare fairly.</p> : null}
    </Panel>
    <Notice tone="task">Use rankings to find who to learn from and who needs support, not as a sales league table: outcomes are from conversations, not CRM sales.</Notice>
  </div>;
}
