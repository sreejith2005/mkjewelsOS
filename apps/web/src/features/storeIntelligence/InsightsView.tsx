import { useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  CONVERSATION_STAGES, formatDuration, formatRecordedTotal, OUTCOME_LABEL, SALES_OUTCOMES, SI_CATEGORIES, SI_CATEGORY_LABEL, SI_CRM_CLASSES, SI_CRM_CLASS_LABEL, SI_DEFINITIONS,
  SI_ELEMENTS, SI_ELEMENT_LABEL, SI_PERIOD_LABEL, SI_PERIODS, siActiveFilterCount, siChange, siDaysBetween, siFilterKey, siFiltersFromQuery, siFiltersToQuery, siFreshnessText,
  siPeriodRange, siRank, siRate, siRateText, siServerFilters, STAGE_LABEL, type SiAnalytics, type SiFilters, type SiOptions, type SiPeriod, type SiServerFilters,
} from "@jewelos/core";
import { fetchSiAnalytics, fetchSiDeviceDays, fetchSiOptions } from "@jewelos/data";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { BreakdownList, dailyPoints, dayLabel, DrillContext, DrillDrawer, Figure, incompleteNote, periodText, scoreText, type DrillRequest } from "./analyticsUi";
import { CoachingAnalytics, CustomerAnalytics, LeadershipAnalytics, RankingsAnalytics, SalesAnalytics } from "./AnalyticsSections";
import { BarChart, LineChart } from "./charts";
import { siPath, type InsightView } from "./routes";
import { Drawer, EmptyState, ErrorState, Panel, SkeletonRows } from "./ui";
import { useLoad } from "./useLoad";
import { useRevisionQuery } from "./useRevisionQuery";

const VIEWS: readonly { id: InsightView; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "conversations", label: "Conversations" }, { id: "devices", label: "Device time" }, { id: "sales", label: "Sales & Demand" },
  { id: "coaching", label: "Coaching" }, { id: "customers", label: "Customer Insights" }, { id: "leadership", label: "Leadership" }, { id: "rankings", label: "Rankings" },
];
export function InsightsView({ navigate, view, search }: { navigate: (path: string) => void; view: InsightView; search: string }) {
  const filters = useMemo(() => siFiltersFromQuery(search), [search]);
  const key = siFilterKey(filters);
  const server = useMemo(() => siServerFilters(filters), [filters]);
  const options = useLoad(fetchSiOptions, []);
  // One summary per filter revision; switching views reuses it.
  const summary = useRevisionQuery(key, (signal) => fetchSiAnalytics(server, signal));
  const [drill, setDrill] = useState<DrillRequest | null>(null);
  const go = (next: SiFilters, nextView: InsightView = view) => navigate(siPath.insights(nextView, siFiltersToQuery(next)));
  const data = summary.data;
  const stale = summary.loading && summary.dataKey !== key;
  const api = useMemo(() => ({ open: setDrill, base: server, periodText: periodText(filters.from, filters.to) }), [server, filters.from, filters.to]);
  const freshness = data ? siFreshnessText(data.meta) : null;
  return <DrillContext.Provider value={api}>
    <div className="space-y-4">
      <header className="space-y-3">
        <div><h1 className="text-2xl font-semibold text-task-text">Insights</h1>
          <p className="mt-0.5 text-sm text-task-text-muted">{scopeText(filters, options.data)} · {periodText(filters.from, filters.to)}</p></div>
        <FilterBar filters={filters} key={key} onChange={go} options={options.data} />
      </header>
      <nav aria-label="Insight views" className="scroll-x no-scrollbar -mx-1 flex gap-1 px-1 py-1">
        {VIEWS.map((item) => <a aria-current={item.id === view ? "page" : undefined} className={cn("inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold",
          item.id === view ? "bg-task-text text-task-bg" : "text-task-text-muted hover:bg-task-muted hover:text-task-text")} href={siPath.insights(item.id, siFiltersToQuery(filters))} key={item.id}
          onClick={(event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return; event.preventDefault(); go(filters, item.id); }}>{item.label}</a>)}
      </nav>
      {freshness ? <p aria-live="polite" className={cn("text-xs", freshness.tone === "lag" ? "text-task-text" : "text-task-text-muted")}>
        {stale ? "Updating for the new filters… " : ""}{freshness.text}</p> : null}
      <div aria-busy={stale} className={cn("transition-opacity motion-reduce:transition-none", stale && "opacity-60")}>
        {view === "devices" ? <DeviceTime filters={filters} server={server} />
          : summary.error && !data ? <ErrorState message={summary.error} onRetry={summary.reload} />
          : !data ? <SkeletonRows label="Loading insights" rows={3} />
          : !data.current.sessions && !data.prior.sessions ? <EmptyState title="No conversations for these filters">Try a longer period or fewer filters. Device time shows whether recorders were in use.</EmptyState>
          : view === "overview" ? <Overview data={data} />
          : view === "conversations" ? <ConversationsAnalytics data={data} />
          : view === "sales" ? <SalesAnalytics data={data} />
          : view === "coaching" ? <CoachingAnalytics data={data} navigate={navigate} />
          : view === "customers" ? <CustomerAnalytics data={data} />
          : view === "leadership" ? <LeadershipAnalytics data={data} />
          : <RankingsAnalytics data={data} />}
      </div>
    </div>
    {drill ? <DrillDrawer navigate={navigate} onClose={() => setDrill(null)} request={drill} /> : null}
  </DrillContext.Provider>;
}

function scopeText(filters: SiFilters, options: SiOptions | null): string {
  if (!options) return "Your branch";
  if (!filters.branch_ids.length && options.all_branches && options.branches.length > 1) return `All branches (${options.branches.length})`;
  const names = (filters.branch_ids.length ? options.branches.filter((b) => filters.branch_ids.includes(b.id)) : options.branches).map((b) => b.name);
  return names.length <= 2 ? names.join(", ") || "Your branch" : `${names.length} branches`;
}

// ---------------------------------------------------------------------------------------------
// Filters: period first, everything else in a drawer; applied filters show as removable chips.
// ---------------------------------------------------------------------------------------------
function FilterBar({ filters, options, onChange }: { filters: SiFilters; options: SiOptions | null; onChange: (next: SiFilters) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState({ from: filters.from, to: filters.to });
  const choose = (period: SiPeriod) => {
    if (period === "custom") { onChange({ ...filters, period }); return; }
    onChange({ ...filters, period, ...siPeriodRange(period) });
  };
  const customValid = Boolean(custom.from && custom.to) && custom.from <= custom.to && siDaysBetween(custom.from, custom.to) <= 366;
  const chips = activeChips(filters, options);
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      <div aria-label="Period" className="inline-flex flex-wrap rounded-full border border-task-border bg-task-bg p-1" role="radiogroup">
        {SI_PERIODS.map((period) => <button aria-checked={filters.period === period} className={cn("min-h-11 rounded-full px-3 text-sm font-semibold", filters.period === period ? "bg-task-text text-task-bg" : "text-task-text-muted hover:text-task-text")}
          key={period} onClick={() => choose(period)} role="radio" type="button">{SI_PERIOD_LABEL[period]}</button>)}
      </div>
      <Button className="min-h-11" onClick={() => setOpen(true)} type="button" variant="secondary"><SlidersHorizontal aria-hidden className="size-4" />Filters{siActiveFilterCount(filters) ? ` (${siActiveFilterCount(filters)})` : ""}</Button>
    </div>
    {filters.period === "custom" ? <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (customValid) onChange({ ...filters, period: "custom", ...custom }); }}>
      <label className="block"><span className="label">From</span><input className="field" max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} required type="date" value={custom.from} /></label>
      <label className="block"><span className="label">To</span><input className="field" min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} required type="date" value={custom.to} /></label>
      <Button className="min-h-11" disabled={!customValid} type="submit">Apply dates</Button>
      {!customValid ? <p className="w-full text-xs text-danger" role="alert">Choose a start on or before the end, at most 366 days.</p> : null}
    </form> : null}
    {chips.length ? <ul aria-label="Applied filters" className="flex flex-wrap gap-2">{chips.map((chip) => <li key={chip.key}>
      <button className="inline-flex min-h-9 items-center gap-1 rounded-full border border-task-border bg-task-bg px-3 text-xs font-semibold text-task-text hover:bg-task-muted" onClick={() => onChange(chip.clear())} type="button">
        {chip.label}<X aria-hidden className="size-3.5" /><span className="sr-only">Remove filter</span></button></li>)}</ul> : null}
    {open ? <FilterDrawer filters={filters} onApply={(next) => { setOpen(false); onChange(next); }} onClose={() => setOpen(false)} options={options} /> : null}
  </div>;
}

type Chip = { key: string; label: string; clear: () => SiFilters };
function activeChips(f: SiFilters, options: SiOptions | null): Chip[] {
  const name = (list: readonly { id: string; name: string }[] | undefined, id: string) => list?.find((item) => item.id === id)?.name ?? "Selected";
  const chips: Chip[] = [];
  for (const id of f.branch_ids) chips.push({ key: `b${id}`, label: name(options?.branches, id), clear: () => ({ ...f, branch_ids: f.branch_ids.filter((x) => x !== id) }) });
  for (const id of f.employee_ids) chips.push({ key: `e${id}`, label: name(options?.employees, id), clear: () => ({ ...f, employee_ids: f.employee_ids.filter((x) => x !== id) }) });
  const without = (key: "device_id" | "category" | "element" | "product" | "stage" | "outcome" | "crm") => () => { const next = { ...f }; delete next[key]; return next; };
  if (f.device_id) chips.push({ key: "device", label: options?.devices.find((d) => d.id === f.device_id)?.label ?? "Phone", clear: without("device_id") });
  if (f.category) chips.push({ key: "cat", label: SI_CATEGORY_LABEL[f.category], clear: without("category") });
  if (f.element) chips.push({ key: "el", label: SI_ELEMENT_LABEL[f.element], clear: without("element") });
  if (f.product) chips.push({ key: "product", label: `“${f.product}”`, clear: without("product") });
  if (f.stage) chips.push({ key: "stage", label: STAGE_LABEL[f.stage], clear: without("stage") });
  if (f.outcome) chips.push({ key: "outcome", label: `AI: ${OUTCOME_LABEL[f.outcome]}`, clear: without("outcome") });
  if (f.crm) chips.push({ key: "crm", label: SI_CRM_CLASS_LABEL[f.crm], clear: without("crm") });
  return chips;
}

function FilterDrawer({ filters, options, onApply, onClose }: { filters: SiFilters; options: SiOptions | null; onApply: (next: SiFilters) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<SiFilters>(filters);
  const [personQuery, setPersonQuery] = useState("");
  const set = (patch: { [K in keyof SiFilters]?: SiFilters[K] | undefined }) => setDraft((d) => {
    const next = { ...d, ...patch } as { -readonly [K in keyof SiFilters]?: SiFilters[K] | undefined } & Pick<SiFilters, "period" | "from" | "to" | "branch_ids" | "employee_ids">;
    for (const k of ["device_id", "category", "element", "product", "stage", "outcome", "crm"] as const) if (!next[k]) delete next[k];
    return next as SiFilters; // Undefined keys were deleted above.
  });
  const toggle = (list: readonly string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(0, 50));
  const people = (options?.employees ?? []).filter((e) => (!draft.branch_ids.length || (e.branch_id !== null && draft.branch_ids.includes(e.branch_id))) && e.name.toLowerCase().includes(personQuery.trim().toLowerCase()));
  const select = <T extends string>(label: string, value: T | undefined, values: readonly T[], text: (v: T) => string, onPick: (v: T | undefined) => void) => <label className="block">
    <span className="label">{label}</span>
    <select className="field" onChange={(e) => onPick(values.find((v) => v === e.target.value))} value={value ?? ""}><option value="">Any</option>{values.map((v) => <option key={v} value={v}>{text(v)}</option>)}</select>
  </label>;
  return <Drawer footer={<><Button className="flex-1" onClick={() => onApply({ period: draft.period, from: draft.from, to: draft.to, branch_ids: [], employee_ids: [] })} type="button" variant="secondary">Clear all</Button>
    <Button className="flex-1" onClick={() => onApply(draft)} type="button">Apply</Button></>} onClose={onClose} title="Filters">
    <div className="space-y-4">
      {options && options.branches.length > 1 ? <fieldset><legend className="label">Branches</legend>
        <p className="mb-1 text-xs text-task-text-muted">None ticked = every branch you can see.</p>
        <div className="space-y-1">{options.branches.map((b) => <label className="flex min-h-11 items-center gap-2 text-sm" key={b.id}><input checked={draft.branch_ids.includes(b.id)} onChange={() => set({ branch_ids: toggle(draft.branch_ids, b.id) })} type="checkbox" />{b.name}</label>)}</div>
      </fieldset> : null}
      <fieldset><legend className="label">Salespeople</legend>
        <input aria-label="Find a salesperson" className="field mb-1" onChange={(e) => setPersonQuery(e.target.value)} placeholder="Find a name" type="search" value={personQuery} />
        <div className="max-h-48 space-y-1 overflow-y-auto">{people.length ? people.map((e) => <label className="flex min-h-11 items-center gap-2 text-sm" key={e.id}>
          <input checked={draft.employee_ids.includes(e.id)} onChange={() => set({ employee_ids: toggle(draft.employee_ids, e.id) })} type="checkbox" />{e.name}</label>) : <p className="text-sm text-task-text-muted">No one matches.</p>}</div>
      </fieldset>
      <label className="block"><span className="label">Phone</span>
        <select className="field" onChange={(e) => set({ device_id: e.target.value || undefined })} value={draft.device_id ?? ""}><option value="">Any</option>
          {(options?.devices ?? []).map((d) => <option key={d.id} value={d.id}>{d.label} ({d.employee_name})</option>)}</select></label>
      {select("Product type", draft.category, SI_CATEGORIES, (v) => SI_CATEGORY_LABEL[v], (v) => set({ category: v }))}
      {select("Metal or design", draft.element, SI_ELEMENTS, (v) => SI_ELEMENT_LABEL[v], (v) => set({ element: v }))}
      <label className="block"><span className="label">Product words</span><input className="field" maxLength={100} onChange={(e) => set({ product: e.target.value || undefined })} placeholder="For example: temple necklace" value={draft.product ?? ""} /></label>
      {select("Status", draft.stage, CONVERSATION_STAGES, (v) => STAGE_LABEL[v], (v) => set({ stage: v }))}
      {select("What the AI heard", draft.outcome, SALES_OUTCOMES, (v) => OUTCOME_LABEL[v], (v) => set({ outcome: v }))}
      {select("CRM outcome", draft.crm, SI_CRM_CLASSES, (v) => SI_CRM_CLASS_LABEL[v], (v) => set({ crm: v }))}
    </div>
  </Drawer>;
}

// ---------------------------------------------------------------------------------------------
// Overview (home / trends) and Conversations.
// ---------------------------------------------------------------------------------------------
function Overview({ data }: { data: SiAnalytics }) {
  const c = data.current; const p = data.prior; const min = data.meta.min_sample;
  const conversion = siRate(c.crm.confirmed, c.crm.eligible, min); const prior = siRate(p.crm.confirmed, p.crm.eligible, min);
  const note = incompleteNote(data);
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure change={siChange(c.sessions, p.sessions, "count")} definition={SI_DEFINITIONS.sessions} emphasis sample={`Prior period: ${p.sessions}`} value={c.sessions} />
      <Figure change={c.scored >= min && p.scored >= min ? siChange(c.average_score, p.average_score, "points") : null} definition={SI_DEFINITIONS.average_score} disclaimer={note ?? undefined}
        sample={c.scored ? `N = ${c.scored} scored of ${c.sessions}` : "Nothing scored yet"} value={c.scored >= min ? scoreText(c.average_score) : c.scored ? `${scoreText(c.average_score)}*` : "—"} />
      <Figure definition={SI_DEFINITIONS.average_duration} sample={`N = ${c.with_audio} with audio`} value={c.average_duration_ms === null ? "—" : formatDuration(c.average_duration_ms)} />
      <Figure change={conversion.state === "ok" && prior.state === "ok" ? siChange(conversion.value, prior.value, "rate") : null} definition={SI_DEFINITIONS.conversion_rate}
        disclaimer={`${c.crm.not_linked} not linked to a CRM customer (unknown) and ${c.crm.pending} waiting for the CRM are left out.`}
        sample={`${c.crm.confirmed} confirmed of ${c.crm.eligible} eligible`} value={siRateText(conversion)} />
    </div>
    {c.scored > 0 && c.scored < min ? <p className="text-xs text-task-text-muted">* Average from fewer than {min} scored conversations: too few to compare.</p> : null}
    <Panel><BarChart points={dailyPoints(data, (d) => d?.sessions ?? 0)} title="Conversations per day" valueLabel="Conversations" /></Panel>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel><LineChart format={(v) => String(Math.round(v))} points={dailyPoints(data, (d) => (d && d.scored ? d.average_score : null))} title="Average score per day (0–100; gaps = nothing scored)" valueLabel="Average score" /></Panel>
      <Panel><BarChart format={(v) => `${v.toFixed(1)} min`} points={dailyPoints(data, (d) => (d?.average_duration_ms ? d.average_duration_ms / 60_000 : null))} title="Average length per day (minutes)" valueLabel="Average length" /></Panel>
    </div>
    <p className="text-xs text-task-text-muted">Compared with {periodText(data.meta.prior_from, data.meta.prior_to)}. Each chart has its own scale. {note ?? ""}</p>
  </div>;
}

function ConversationsAnalytics({ data }: { data: SiAnalytics }) {
  const c = data.current; const min = data.meta.min_sample;
  const byConversion = siRank(data.by_employee, "conversion", min).ranked[0];
  const byScore = siRank(data.by_employee, "score", min).ranked[0];
  const top = byConversion ? { name: byConversion.row.employee_name, text: `${byConversion.value}% confirmed of ${byConversion.sample} eligible` }
    : byScore ? { name: byScore.row.employee_name, text: `average score ${Math.round(byScore.value)} over ${byScore.sample} scored (too few CRM-checked conversations to use conversion)` } : null;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure definition={SI_DEFINITIONS.sessions} value={c.sessions} />
      <Figure definition={SI_DEFINITIONS.confirmed} sample={`of ${c.crm.eligible} CRM-checked`} value={c.crm.confirmed} />
      <Figure definition={SI_DEFINITIONS.follow_up} sample={`of ${c.analysed} analysed`} value={c.outcomes.follow_up} />
      <Figure definition={SI_DEFINITIONS.lost} sample={`${c.crm.open} still within the window`} value={c.crm.lost} />
      <Figure definition={SI_DEFINITIONS.unscored} sample={`of ${c.analysed} analysed`} value={c.unscored} />
      <Figure definition={SI_DEFINITIONS.not_analysed} sample={`${c.processing} still processing`} value={c.not_analysed} />
      <Figure definition={SI_DEFINITIONS.retention_removed} value={c.retention_removed} />
      <Figure definition={SI_DEFINITIONS.average_duration} sample={`Total ${formatRecordedTotal(c.recorded_ms)}`} value={c.average_duration_ms === null ? "—" : formatDuration(c.average_duration_ms)} />
    </div>
    <Panel description="Highest confirmed conversion with at least the minimum sample; average score when too few are CRM-checked." title="Top associate">
      {top ? <p className="text-sm text-task-text"><span className="font-semibold">{top.name}</span>: {top.text}.</p> : <p className="text-sm text-task-text-muted">No one has {min} or more scored or CRM-checked conversations yet.</p>}
    </Panel>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel description={`From what was said, ${c.analysed} analysed conversations. Not CRM records.`} title="What the AI heard">
        <BreakdownList empty="Nothing analysed yet." items={SALES_OUTCOMES.map((o) => ({ key: o, label: OUTCOME_LABEL[o], value: c.outcomes[o], drill: { title: `AI: ${OUTCOME_LABEL[o]}`, metric: `outcome:${o}` } }))} label="AI outcomes" />
      </Panel>
      <Panel description="Each CRM purchase visit is credited to one conversation." title="What the CRM shows">
        <BreakdownList empty="No conversations." items={SI_CRM_CLASSES.map((k) => ({ key: k, label: SI_CRM_CLASS_LABEL[k], value: c.crm[k], drill: { title: SI_CRM_CLASS_LABEL[k], metric: `crm:${k}` } }))} label="CRM outcomes" />
      </Panel>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Device time: per phone and India day, paged. Fetched only when this view is open.
// ---------------------------------------------------------------------------------------------
function DeviceTime({ filters, server }: { filters: SiFilters; server: SiServerFilters }) {
  const [page, setPage] = useState({ key: "", offset: 0 });
  const key = siFilterKey(filters);
  const offset = page.key === key ? page.offset : 0;
  const days = useRevisionQuery(`${key}|${offset}`, (signal) => fetchSiDeviceDays(server, offset, signal));
  const data = days.data;
  if (days.error && !data) return <ErrorState message={days.error} onRetry={days.reload} />;
  if (!data) return <SkeletonRows label="Loading device time" rows={3} />;
  return <div className="space-y-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Figure definition={{ label: "Connected time", meaning: "Time the recorder app was in contact with the server: contacts no more than 2 minutes apart.", calculation: "Sum of gaps of 2 minutes or less between contacts; longer silences count as not connected.", metric: "sessions" }}
        drill={false} sample={`${data.totals.devices} phones`} value={formatRecordedTotal(data.totals.connected_ms)} />
      <Figure definition={{ label: "Recorded time", meaning: "Saved audio from conversations started that day.", calculation: "Sum of saved audio.", metric: "with_audio" }} sample={`${data.totals.sessions} conversations`} value={formatRecordedTotal(data.totals.recorded_ms)} />
    </div>
    <Panel description="Live status (recording now, idle, not seen) is on the Devices tab." title="Daily time per phone">
      {data.rows.length ? <div className="scroll-x -mx-1 px-1"><table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">Connected and recorded time per phone and day, India time</caption>
        <thead><tr className="text-left text-xs text-task-text-muted"><th className="py-2 pr-2 font-semibold" scope="col">Day</th><th className="py-2 pr-2 font-semibold" scope="col">Salesperson</th>
          <th className="py-2 pr-2 text-right font-semibold" scope="col">Connected</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Recorded</th><th className="py-2 pr-2 text-right font-semibold" scope="col">Conversations</th><th className="py-2 font-semibold" scope="col">Last contact</th></tr></thead>
        <tbody>{data.rows.map((r) => <tr className="border-t border-task-border" key={`${r.device_id}-${r.date}`}>
          <td className="py-2 pr-2 tabular-nums">{dayLabel(r.date)}</td>
          <th className="py-2 pr-2 text-left font-normal" scope="row"><span className="font-semibold">{r.employee_name}</span><span className="block text-xs text-task-text-muted">{r.device_label} · {r.branch_name}</span></th>
          <td className="py-2 pr-2 text-right tabular-nums">{r.connected_ms === null ? <span className="text-task-text-muted">Not logged</span> : formatRecordedTotal(r.connected_ms)}</td>
          <td className="py-2 pr-2 text-right tabular-nums">{r.recorded_ms ? formatRecordedTotal(r.recorded_ms) : "0"}</td>
          <td className="py-2 pr-2 text-right tabular-nums">{r.sessions}</td>
          <td className="py-2 text-xs text-task-text-muted">{r.last_contact_at ? new Date(r.last_contact_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "—"}</td>
        </tr>)}</tbody></table></div> : <p className="text-sm text-task-text-muted">No phone was used in this period.</p>}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-task-border pt-3 text-sm text-task-text-muted">
        <span aria-live="polite">{data.total ? `${offset + 1}–${offset + data.rows.length} of ${data.total}` : "0 rows"}</span>
        <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setPage({ key, offset: Math.max(0, offset - 25) })} type="button" variant="secondary">Previous</Button>
          <Button disabled={offset + 25 >= data.total} onClick={() => setPage({ key, offset: offset + 25 })} type="button" variant="secondary">Next</Button></div>
      </div>
    </Panel>
    <Notice tone="task">{data.presence_since ? `Connected time is logged from ${dayLabel(data.presence_since)}; earlier days show "Not logged". ` : "Connected time is logged from now on. "}
      The recorder does not send battery level, so it is not shown. Live status: recording needs audio in the last 2 minutes; idle means seen in the last 15 minutes.</Notice>
  </div>;
}
