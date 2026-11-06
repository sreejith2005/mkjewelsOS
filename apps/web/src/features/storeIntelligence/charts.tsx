import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ChartPoint = Readonly<{ key: string; label: string; value: number | null }>;

function niceMax(values: readonly number[]): number {
  const max = Math.max(0, ...values);
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
}

/** Table twin of a chart: the exact numbers, for screen readers and careful reading. */
function ChartTable({ points, valueLabel, format }: { points: readonly ChartPoint[]; valueLabel: string; format: (value: number) => string }) {
  return <div className="max-h-64 overflow-y-auto rounded-lg border border-task-border">
    <table className="w-full text-sm">
      <thead className="sticky top-0 bg-task-muted text-left text-xs text-task-text-muted"><tr><th className="px-3 py-2 font-semibold" scope="col">When</th><th className="px-3 py-2 text-right font-semibold" scope="col">{valueLabel}</th></tr></thead>
      <tbody>{points.map((point) => <tr className="border-t border-task-border" key={point.key}><th className="px-3 py-1.5 text-left font-normal text-task-text" scope="row">{point.label}</th><td className="px-3 py-1.5 text-right tabular-nums text-task-text">{point.value === null ? "—" : format(point.value)}</td></tr>)}</tbody>
    </table>
  </div>;
}

function ChartFrame({ title, summary, points, valueLabel, format, children }: {
  title: string; summary: string; points: readonly ChartPoint[]; valueLabel: string; format: (value: number) => string; children: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return <figure aria-labelledby={id} className="space-y-3">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <figcaption className="text-sm font-semibold text-task-text" id={id}>{title}</figcaption>
      <button aria-pressed={asTable} className="min-h-11 rounded-lg px-2 text-xs font-semibold text-task-text-muted underline-offset-2 hover:text-task-text hover:underline" onClick={() => setAsTable((value) => !value)} type="button">{asTable ? "Show chart" : "Show as table"}</button>
    </div>
    <p className="sr-only">{summary}</p>
    {asTable ? <ChartTable format={format} points={points} valueLabel={valueLabel} /> : children}
  </figure>;
}

/** Vertical bars for counts over time or by hour. One series, one colour, no legend. */
export function BarChart({ title, points, valueLabel, format = (value) => String(value), height = 160 }: {
  title: string; points: readonly ChartPoint[]; valueLabel: string; format?: (value: number) => string; height?: number;
}) {
  const values = points.map((point) => point.value ?? 0);
  const max = niceMax(values);
  const [active, setActive] = useState<string | null>(null);
  const peak = points.reduce<ChartPoint | null>((best, point) => (point.value !== null && (!best || point.value > (best.value ?? 0)) ? point : best), null);
  const summary = points.length ? `${points.length} bars. Highest: ${peak ? `${peak.label}, ${format(peak.value ?? 0)}` : "none"}.` : "No data.";
  const showEvery = Math.max(1, Math.ceil(points.length / 7));
  return <ChartFrame format={format} points={points} summary={summary} title={title} valueLabel={valueLabel}>
    <div aria-hidden className="relative" style={{ height }}>
      <span className="absolute -top-1 left-0 text-[11px] tabular-nums text-task-text-muted">{format(max)}</span>
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-task-border" />
      <div className="absolute inset-0 flex items-end gap-0.5 border-b border-task-border pt-4">
        {points.map((point) => {
          const value = point.value ?? 0;
          return <div className="group relative flex h-full min-w-0 flex-1 items-end justify-center" key={point.key}
            onBlur={() => setActive(null)} onFocus={() => setActive(point.key)} onMouseEnter={() => setActive(point.key)} onMouseLeave={() => setActive(null)} tabIndex={-1}>
            <div className={cn("w-full max-w-6 rounded-t-[4px] bg-gold transition-[filter] motion-reduce:transition-none", active === point.key && "brightness-90")} style={{ height: `${(value / max) * 100}%`, minHeight: value > 0 ? 2 : 0 }} />
            {active === point.key ? <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-task-border bg-task-bg px-2 py-1 text-xs text-task-text shadow-lift">
              <span className="font-semibold">{point.label}</span> · {point.value === null ? "—" : format(point.value)}</div> : null}
          </div>;
        })}
      </div>
    </div>
    {points.length > 13
      ? <div aria-hidden className="flex justify-between text-[11px] text-task-text-muted"><span>{points[0]?.label}</span><span>{points[Math.floor(points.length / 2)]?.label}</span><span>{points.at(-1)?.label}</span></div>
      : <div aria-hidden className="flex gap-0.5">{points.map((point, index) => <span className="min-w-0 flex-1 truncate text-center text-[11px] text-task-text-muted" key={point.key}>{index % showEvery === 0 ? point.label : ""}</span>)}</div>}
  </ChartFrame>;
}

/** A 2px line for a rate over time; gaps stay gaps (days with no scored conversations). */
export function LineChart({ title, points, valueLabel, format = (value) => String(value), min = 0, max = 100, height = 160 }: {
  title: string; points: readonly ChartPoint[]; valueLabel: string; format?: (value: number) => string; min?: number; max?: number; height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const known = points.filter((point) => point.value !== null);
  const summary = known.length ? `From ${format(known[0]!.value ?? 0)} on ${known[0]!.label} to ${format(known.at(-1)!.value ?? 0)} on ${known.at(-1)!.label}.` : "No scored days."; // known is non-empty here.
  const x = (index: number) => (points.length <= 1 ? 50 : (index / (points.length - 1)) * 100);
  const y = (value: number) => 100 - ((value - min) / (max - min)) * 100;
  const segments: string[] = []; let current = "";
  points.forEach((point, index) => {
    if (point.value === null) { if (current) segments.push(current); current = ""; return; }
    current += `${current ? "L" : "M"}${x(index)},${y(point.value)}`;
  });
  if (current) segments.push(current);
  const activePoint = active === null ? null : points[active];
  return <ChartFrame format={format} points={points} summary={summary} title={title} valueLabel={valueLabel}>
    <div aria-hidden className="relative" onMouseLeave={() => setActive(null)}
      onMouseMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); const ratio = (event.clientX - box.left) / box.width; setActive(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1))))); }}
      style={{ height }}>
      <span className="absolute -top-1 left-0 text-[11px] tabular-nums text-task-text-muted">{format(max)}</span>
      <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-task-border" />
      <svg className="absolute inset-0 size-full overflow-visible border-b border-task-border" preserveAspectRatio="none" viewBox="0 0 100 100">
        {segments.map((path) => <path className="stroke-gold" d={path} fill="none" key={path} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {points.map((point, index) => point.value === null ? null : <span className={cn("absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gold ring-2 ring-task-bg", active === index && "size-3")} key={point.key} style={{ left: `${x(index)}%`, top: `${y(point.value)}%` }} />)}
      {activePoint ? <>
        <div className="absolute inset-y-0 border-l border-task-text-muted/40" style={{ left: `${x(active!)}%` }} />
        <div className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-task-border bg-task-bg px-2 py-1 text-xs text-task-text shadow-lift" style={{ left: `clamp(3rem, ${x(active!)}%, calc(100% - 3rem))` }}>
          <span className="font-semibold">{activePoint.label}</span> · {activePoint.value === null ? "No score" : format(activePoint.value)}</div>
      </> : null}
    </div>
    <div aria-hidden className="flex justify-between text-[10px] text-task-text-muted"><span>{points[0]?.label}</span><span>{points.at(-1)?.label}</span></div>
  </ChartFrame>;
}

/** Ranked horizontal bars for "top N" lists; the count is printed, the bar only helps comparison. */
/** `scaleMax` fixes the scale (for example 10 for ratings out of 10) so bars are not stretched to the largest item. */
export function RankedBars({ items, label, format = (value: number) => String(value), scaleMax }: { items: readonly Readonly<{ label: string; value: number }>[]; label: string; format?: (value: number) => string; scaleMax?: number }) {
  const max = scaleMax ?? Math.max(1, ...items.map((item) => item.value));
  return <ol aria-label={label} className="space-y-2">
    {items.map((item) => <li className="space-y-1" key={item.label}>
      <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate text-task-text">{item.label}</span><span className="shrink-0 tabular-nums text-task-text-muted">{format(item.value)}</span></div>
      <div aria-hidden className="h-1.5 rounded-full bg-task-muted"><div className="h-full rounded-full bg-gold" style={{ width: `${(item.value / max) * 100}%` }} /></div>
    </li>)}
  </ol>;
}
