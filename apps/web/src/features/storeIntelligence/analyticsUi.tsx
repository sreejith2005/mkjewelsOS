import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import {
  formatDuration, istTime, OUTCOME_LABEL, SI_CRM_CLASS_LABEL, SI_DOW_LABEL, SI_TIMEZONE, type SiAnalytics, type SiChange, type SiDefinition, type SiServerFilters, type SiSessionRow,
} from "@jewelos/core";
import { fetchSiSessions, type SiCursor } from "@jewelos/data";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ChartPoint } from "./charts";
import { siPath } from "./routes";
import { Drawer, ErrorState, ScoreBadge, SkeletonRows } from "./ui";
import { usePagedQuery } from "./useRevisionQuery";

/** What a drill-down shows: the figure's own words and the exact server filters behind it. */
export type DrillRequest = Readonly<{ title: string; metric: string; filters: SiServerFilters; note?: string }>;
type DrillApi = Readonly<{ open: (request: DrillRequest) => void; base: SiServerFilters; periodText: string }>;
export const DrillContext = createContext<DrillApi | null>(null);
/** A drill target; `filters` adds to (or overrides) the view's own filters, e.g. one person or one day. */
export type DrillTarget = Readonly<{ title: string; metric: string; filters?: SiServerFilters; note?: string }>;
export function resolveDrill(target: DrillTarget, base: SiServerFilters): DrillRequest {
  return { title: target.title, metric: target.metric, filters: { ...base, ...target.filters }, ...(target.note ? { note: target.note } : {}) };
}
export function useDrill(): DrillApi {
  const api = useContext(DrillContext);
  if (!api) throw new Error("useDrill outside the analytics view");
  return api;
}

const dateText = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export function periodText(from: string, to: string): string {
  return from === to ? `${dateText(from)} (India time)` : `${dateText(from)} – ${dateText(to)} (India time)`;
}

/**
 * One figure: value, sample size, change vs the prior period, its definition, and a button that
 * lists the conversations behind it. "—" means unknown; "Too few" means below the minimum sample.
 */
export function Figure({ definition, value, sample, change, disclaimer, drill, emphasis = false }: {
  definition: SiDefinition; value: ReactNode; sample?: string | undefined; change?: SiChange | null; disclaimer?: string | undefined; drill?: Partial<DrillTarget> | false; emphasis?: boolean;
}) {
  const api = useDrill();
  const [open, setOpen] = useState(false);
  const id = useId();
  const request: DrillRequest | null = drill === false ? null
    : resolveDrill({ title: drill?.title ?? definition.label, metric: drill?.metric ?? definition.metric, ...(drill?.filters ? { filters: drill.filters } : {}), ...(drill?.note ? { note: drill.note } : {}) }, api.base);
  return <div className={cn("min-w-0 rounded-xl border border-task-border bg-task-bg p-3 sm:p-4", emphasis && "border-gold/40")}>
    <div className="flex items-start justify-between gap-1">
      <p className="min-w-0 truncate text-xs font-medium text-task-text-muted" id={`${id}-label`}>{definition.label}</p>
      <button aria-controls={`${id}-def`} aria-expanded={open} aria-label={`How ${definition.label} is counted`} className="-m-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-task-text-muted hover:bg-task-muted hover:text-task-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
        onClick={() => setOpen((value) => !value)} type="button"><Info aria-hidden className="size-4" /></button>
    </div>
    {request ? <button aria-describedby={`${id}-meta`} className="mt-1 block rounded-md text-left text-2xl font-semibold tabular-nums tracking-tight text-task-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
      onClick={() => api.open(request)} title="Show the conversations behind this figure" type="button">{value ?? "—"}<span className="sr-only">: show the conversations behind {definition.label}</span></button>
      : <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-task-text">{value ?? "—"}</p>}
    <div className="mt-0.5 space-y-0.5 text-xs text-task-text-muted" id={`${id}-meta`}>
      {sample ? <p>{sample}</p> : null}
      {change ? <p className={cn(change.direction === "up" ? "text-success" : change.direction === "down" ? "text-danger" : undefined)}>{change.direction === "up" ? "▲ " : change.direction === "down" ? "▼ " : ""}{change.text}</p> : null}
    </div>
    <div className="mt-2 space-y-1 border-t border-task-border pt-2 text-xs text-task-text-muted" hidden={!open} id={`${id}-def`}>
      <p className="text-task-text">{definition.meaning}</p>
      <p><span className="font-semibold">Calculation:</span> {definition.calculation}</p>
      <p><span className="font-semibold">Period:</span> {api.periodText}. Time zone {SI_TIMEZONE}.</p>
      {disclaimer ? <p>{disclaimer}</p> : null}
    </div>
  </div>;
}

/** A clickable row for breakdown lists (label, count, share and a scale bar). */
export function BreakdownList({ items, label, empty, scaleMax }: {
  items: readonly Readonly<{ key: string; label: string; value: number; detail?: string; drill: DrillTarget }>[]; label: string; empty: string; scaleMax?: number;
}) {
  const api = useDrill();
  if (!items.length) return <p className="text-sm text-task-text-muted">{empty}</p>;
  const max = scaleMax ?? Math.max(1, ...items.map((item) => item.value));
  return <ol aria-label={label} className="space-y-1">
    {items.map((item) => <li key={item.key}>
      <button className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold" onClick={() => api.open(resolveDrill(item.drill, api.base))} type="button">
        <span className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate text-task-text">{item.label}</span>
          <span className="shrink-0 tabular-nums text-task-text-muted">{item.value}{item.detail ? <span className="ml-1 text-xs">· {item.detail}</span> : null}</span></span>
        <span aria-hidden className="mt-1 block h-1.5 rounded-full bg-task-muted"><span className="block h-full rounded-full bg-gold" style={{ width: `${(item.value / max) * 100}%` }} /></span>
      </button>
    </li>)}
  </ol>;
}

/** Visits by day of week and hour (India time). Every cell prints its count; shade only helps. */
export function Heatmap({ slots, onSelect }: { slots: readonly Readonly<{ dow: number; hour: number; sessions: number }>[]; onSelect: (dow: number, hour: number) => void }) {
  const hours = Array.from({ length: 13 }, (_, i) => i + 9); // 9am–9pm; other hours are listed below.
  const max = Math.max(1, ...slots.map((slot) => slot.sessions));
  const at = (dow: number, hour: number) => slots.find((slot) => slot.dow === dow && slot.hour === hour)?.sessions ?? 0;
  const outside = slots.filter((slot) => slot.hour < 9 || slot.hour > 21).reduce((sum, slot) => sum + slot.sessions, 0);
  const shade = (value: number) => (value === 0 ? "" : value / max > 0.75 ? "bg-gold/70" : value / max > 0.5 ? "bg-gold/50" : value / max > 0.25 ? "bg-gold/30" : "bg-gold/15");
  const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`;
  return <div className="space-y-2">
    <div className="scroll-x -mx-1 px-1">
      <table className="w-full min-w-[34rem] border-separate border-spacing-0.5 text-center text-xs">
        <caption className="sr-only">Conversations by day of week (rows) and hour of day (columns), India time</caption>
        <thead><tr><th className="w-10" scope="col"><span className="sr-only">Day</span></th>{hours.map((hour) => <th className="font-medium text-task-text-muted" key={hour} scope="col">{hourLabel(hour)}</th>)}</tr></thead>
        <tbody>{SI_DOW_LABEL.map((day, index) => <tr key={day}>
          <th className="pr-1 text-left font-medium text-task-text-muted" scope="row">{day}</th>
          {hours.map((hour) => { const value = at(index + 1, hour); return <td className="p-0" key={hour}>
            {value ? <button aria-label={`${day} ${hourLabel(hour)}: ${value} conversations`} className={cn("h-8 w-full rounded tabular-nums text-task-text hover:outline hover:outline-1 hover:outline-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold", shade(value))}
              onClick={() => onSelect(index + 1, hour)} type="button">{value}</button> : <span className="block h-8 rounded bg-task-muted/60 leading-8 text-task-text-muted/60">·</span>}
          </td>; })}
        </tr>)}</tbody>
      </table>
    </div>
    {outside ? <p className="text-xs text-task-text-muted">{outside} {outside === 1 ? "conversation was" : "conversations were"} outside 9am–9pm.</p> : null}
  </div>;
}

/** Score (x) against confirmed conversion (y), one dot per person, with a table twin. */
export function Scatter({ points, caption }: { points: readonly Readonly<{ key: string; label: string; x: number; y: number; n: string }>[]; caption: string }) {
  const [asTable, setAsTable] = useState(false);
  if (!points.length) return null;
  return <figure className="space-y-2">
    <div className="flex items-baseline justify-between gap-2"><figcaption className="text-sm font-semibold text-task-text">{caption}</figcaption>
      <button aria-pressed={asTable} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-task-text-muted underline-offset-2 hover:text-task-text hover:underline" onClick={() => setAsTable((v) => !v)} type="button">{asTable ? "Show chart" : "Show as table"}</button></div>
    {asTable ? <table className="w-full text-sm"><thead><tr className="text-left text-xs text-task-text-muted"><th className="py-1 font-semibold" scope="col">Person</th><th className="py-1 text-right font-semibold" scope="col">Avg score</th><th className="py-1 text-right font-semibold" scope="col">Confirmed %</th><th className="py-1 text-right font-semibold" scope="col">Sample</th></tr></thead>
      <tbody>{points.map((p) => <tr className="border-t border-task-border" key={p.key}><th className="py-1.5 text-left font-normal" scope="row">{p.label}</th><td className="py-1.5 text-right tabular-nums">{p.x}</td><td className="py-1.5 text-right tabular-nums">{p.y}%</td><td className="py-1.5 text-right text-xs text-task-text-muted">{p.n}</td></tr>)}</tbody></table>
      : <div aria-hidden className="relative ml-8 mr-2 h-48 border-b border-l border-task-border">
        <span className="absolute -left-8 top-0 text-[11px] text-task-text-muted">100%</span><span className="absolute -left-6 bottom-0 text-[11px] text-task-text-muted">0%</span>
        <span className="absolute -bottom-5 left-0 text-[11px] text-task-text-muted">Score 0</span><span className="absolute -bottom-5 right-0 text-[11px] text-task-text-muted">100</span>
        {points.map((p) => <span className="absolute size-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-gold ring-2 ring-task-bg" key={p.key} style={{ left: `${p.x}%`, bottom: `${p.y}%` }} title={`${p.label}: score ${p.x}, ${p.y}% confirmed (${p.n})`} />)}
      </div>}
    {!asTable ? <p className="pt-4 text-xs text-task-text-muted">Across: average score. Up: confirmed conversion. Use "Show as table" for names and exact values.</p> : null}
  </figure>;
}

const REVIEW_LABEL: Readonly<Record<string, string>> = { approve: "Approved", edit: "Manager edited", flag: "Flagged", unflag: "Unflagged" };
/** The conversations behind a figure, newest first. Metadata only; open needs own-branch access. */
export function DrillDrawer({ request, onClose, navigate }: { request: DrillRequest; onClose: () => void; navigate: (path: string) => void }) {
  const key = JSON.stringify([request.metric, request.filters]);
  const page = usePagedQuery<SiSessionRow, SiCursor>(key, (cursor, signal) => fetchSiSessions(request.filters, request.metric, cursor ?? undefined, signal),
    (row) => ({ before: row.created_at, beforeId: row.session_id }));
  const from = String(request.filters.from); const to = String(request.filters.to);
  return <Drawer onClose={onClose} title={request.title}>
    <div className="space-y-3">
      <p className="text-sm text-task-text-muted" aria-live="polite">{page.total === null ? "Counting…" : `${page.total} ${page.total === 1 ? "conversation" : "conversations"}`} · {periodText(from, to)}</p>
      {request.note ? <p className="text-xs text-task-text-muted">{request.note}</p> : null}
      {page.error && !page.rows.length ? <ErrorState message={page.error} onRetry={page.retry} />
        : !page.rows.length && page.loading ? <SkeletonRows label="Loading conversations" rows={3} />
        : !page.rows.length ? <p className="text-sm text-task-text-muted">No conversations match.</p>
        : <ul className="divide-y divide-task-border">{page.rows.map((row) => <li className="py-2.5" key={row.session_id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-task-text">{row.employee_name}</p>
              <p className="text-xs text-task-text-muted">{new Date(row.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: SI_TIMEZONE })}, {istTime(row.created_at)} · {row.branch_name} · {row.duration_ms ? formatDuration(row.duration_ms) : "no audio"}</p>
              <p className="mt-0.5 text-xs text-task-text-muted">{row.retention_removed ? "Removed after retention" : row.ai_outcome ? `AI: ${OUTCOME_LABEL[row.ai_outcome]}` : "No summary"} · {SI_CRM_CLASS_LABEL[row.crm_class]}{row.review_state ? ` · ${REVIEW_LABEL[row.review_state] ?? ""}` : ""}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <ScoreBadge managerScored={row.manager_scored} score={row.score} />
              {row.can_open ? <Button className="min-h-11" onClick={() => { onClose(); navigate(siPath.conversation(row.session_id)); }} type="button" variant="ghost">Open</Button>
                : <span className="text-xs text-task-text-muted">Open from {row.branch_name}</span>}
            </div>
          </div>
        </li>)}</ul>}
      {page.rows.length && page.error ? <ErrorState message={page.error} onRetry={page.retry} /> : null}
      {page.hasMore ? <Button disabled={page.loading} onClick={page.loadMore} type="button" variant="secondary">{page.loading ? "Loading…" : "Load more"}</Button> : null}
    </div>
  </Drawer>;
}

export const scoreText = (value: number | null) => (value === null ? "—" : String(Math.round(value)));
export const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
/** Every day in the period, so quiet days show as zero (counts) or a gap (averages). */
export function dailyPoints(data: SiAnalytics, pick: (day: SiAnalytics["by_day"][number] | undefined) => number | null): ChartPoint[] {
  const byDate = new Map(data.by_day.map((day) => [day.date, day]));
  const points: ChartPoint[] = []; const end = Date.parse(`${data.meta.to}T00:00:00Z`);
  for (let t = Date.parse(`${data.meta.from}T00:00:00Z`); t <= end; t += 86_400_000) { const key = new Date(t).toISOString().slice(0, 10); points.push({ key, label: dayLabel(key), value: pick(byDate.get(key)) }); }
  return points;
}
/** What the figures leave out, in one sentence. */
export function incompleteNote(data: SiAnalytics): string | null {
  const c = data.current; const parts: string[] = [];
  if (c.processing) parts.push(`${c.processing} still processing`);
  if (c.not_analysed - c.processing > 0) parts.push(`${c.not_analysed - c.processing} without a summary`);
  if (c.retention_removed) parts.push(`${c.retention_removed} removed after the ${data.meta.retention_days}-day retention`);
  return parts.length ? `Scores and topics cover analysed conversations only (${parts.join(", ")}).` : null;
}
