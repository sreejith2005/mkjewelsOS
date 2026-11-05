import { useId, useState, type CSSProperties } from "react";
import { formatTaskPerformanceScore, type DonutSegment, type PerformanceRecordSelector } from "@jewelos/core";

/**
 * Small hand-built charts on the JewelOS theme variables (no chart library, no new colours).
 *
 * The theme's status colours cannot be told apart by colour alone under red-green colour
 * blindness (validated with the dataviz palette checker), so identity never rests on colour:
 * problem states (overdue, late) carry a diagonal hatch, "pending" is drawn hollow, every
 * chart has a legend with counts, and exact values are always one click away.
 */

type Tone = { color: string; hatch?: boolean; hollow?: boolean };
const v = (name: string, alpha = 1) => `rgb(var(--color-${name}) / ${alpha})`;

export const SEGMENT_TONES: Readonly<Record<string, Tone>> = {
  completed: { color: v("success") },
  on_time: { color: v("success") },
  late: { color: v("warning"), hatch: true },
  completed_untimed: { color: v("task-text-muted", 0.55) },
  in_progress: { color: v("gold") },
  pending: { color: v("task-text-muted"), hollow: true },
  overdue: { color: v("task-overdue"), hatch: true },
  remaining: { color: v("task-text-muted"), hollow: true },
  due: { color: v("task-text-muted", 0.4) },
};

const HATCH = `repeating-linear-gradient(45deg, transparent 0 3px, ${v("task-bg", 0.55)} 3px 5px)`;

export function swatchStyle(key: string): CSSProperties {
  const tone = SEGMENT_TONES[key] ?? { color: v("task-text-muted") };
  if (tone.hollow) return { background: v("task-bg"), boxShadow: `inset 0 0 0 1.5px ${tone.color}` };
  return { backgroundColor: tone.color, backgroundImage: tone.hatch ? HATCH : undefined };
}

const pct = (value: number, total: number) => (total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "—");

// ------------------------------------------------------------------------------------ donut

export function Donut({
  title,
  segments,
  total,
  centerLabel,
  onSelect,
}: {
  title: string;
  segments: DonutSegment[];
  total: number;
  centerLabel: string;
  onSelect: (key: PerformanceRecordSelector) => void;
}) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<DonutSegment | null>(null);
  const size = 168;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = segments.filter((s) => s.value > 0);
  const gap = visible.length > 1 ? 2 : 0;
  let offset = 0;
  const shown = hover ?? null;

  return (
    <figure className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg aria-label={`${title}: ${segments.map((s) => `${s.label} ${s.value}`).join(", ")} of ${total}`} height={size} role="img" viewBox={`0 0 ${size} ${size}`} width={size}>
          <defs>
            <pattern height="6" id={`${id}-hatch-overdue`} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="6">
              <rect fill={v("task-overdue")} height="6" width="6" />
              <rect fill={v("task-bg", 0.55)} height="6" width="2" />
            </pattern>
            <pattern height="6" id={`${id}-hatch-late`} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="6">
              <rect fill={v("warning")} height="6" width="6" />
              <rect fill={v("task-bg", 0.55)} height="6" width="2" />
            </pattern>
          </defs>
          <circle cx={size / 2} cy={size / 2} fill="none" r={radius} stroke={v("task-border")} strokeWidth={stroke} />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {visible.map((segment) => {
              const length = (segment.value / Math.max(total, 1)) * circumference;
              const tone = SEGMENT_TONES[segment.key] ?? { color: v("task-text-muted") };
              const paint = tone.hatch ? `url(#${id}-hatch-${segment.key === "late" ? "late" : "overdue"})` : tone.color;
              const dash = Math.max(length - gap, 0.5);
              const element = (
                <circle
                  aria-label={`${segment.label}: ${segment.value} (${pct(segment.value, total)}). Open records.`}
                  className="cursor-pointer outline-none transition-opacity focus-visible:opacity-80"
                  cx={size / 2}
                  cy={size / 2}
                  fill="none"
                  key={segment.key}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect(segment.key)}
                  onFocus={() => setHover(segment)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(segment.key); } }}
                  onMouseEnter={() => setHover(segment)}
                  onMouseLeave={() => setHover(null)}
                  opacity={hover && hover.key !== segment.key ? 0.45 : tone.hollow ? 0.5 : 1}
                  r={radius}
                  role="button"
                  stroke={paint}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  strokeWidth={hover?.key === segment.key ? stroke + 4 : stroke}
                  tabIndex={0}
                >
                  <title>{`${segment.label}: ${segment.value} of ${total} (${pct(segment.value, total)})`}</title>
                </circle>
              );
              offset += length;
              return element;
            })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-2xl font-semibold tabular-nums">{(shown ? shown.value : total).toLocaleString("en-IN")}</span>
          <span className="max-w-[6.5rem] text-[0.6875rem] leading-tight text-task-text-muted">{shown ? `${shown.label} · ${pct(shown.value, total)}` : centerLabel}</span>
        </div>
      </div>
      <ul className="grid w-full min-w-0 gap-1">
        {segments.map((segment) => (
          <li key={segment.key}>
            <button
              className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent"
              onClick={() => onSelect(segment.key)}
              onMouseEnter={() => setHover(segment.value > 0 ? segment : null)}
              onMouseLeave={() => setHover(null)}
              type="button"
            >
              <span aria-hidden className="size-3 shrink-0 rounded-sm" style={swatchStyle(segment.key)} />
              <span className="min-w-0 flex-1 truncate">{segment.label}</span>
              <span className="tabular-nums font-medium">{segment.value.toLocaleString("en-IN")}</span>
              <span className="w-14 text-right text-xs tabular-nums text-task-text-muted">{pct(segment.value, total)}</span>
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

// ------------------------------------------------------------------------------------ legend

export function Legend({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-task-text-muted">
      {items.map(([key, label]) => (
        <li className="flex items-center gap-1.5" key={key}>
          <span aria-hidden className="size-2.5 rounded-sm" style={swatchStyle(key)} />
          {label}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------------------------ stacked bars

export type StackedRow = { id: string; label: string; sublabel?: string | undefined; segments: Array<{ key: PerformanceRecordSelector; label: string; value: number }> };

/** Horizontal stacked bars on one shared scale; each segment opens its records. */
export function StackedBars({
  rows,
  onSelect,
  empty = "No assigned work in this scope.",
}: {
  rows: StackedRow[];
  onSelect: (rowId: string, key: PerformanceRecordSelector) => void;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.segments.reduce((sum, s) => sum + s.value, 0)));
  if (!rows.length) return <p className="py-6 text-center text-sm text-task-text-muted">{empty}</p>;
  return (
    <ul className="grid gap-2.5">
      {rows.map((row) => {
        const total = row.segments.reduce((sum, s) => sum + s.value, 0);
        return (
          <li className="grid grid-cols-[minmax(6rem,11rem)_1fr_2.75rem] items-center gap-3" key={row.id}>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium" title={row.label}>{row.label}</span>
              {row.sublabel ? <span className="block truncate text-[0.6875rem] text-task-text-muted">{row.sublabel}</span> : null}
            </span>
            <span className="flex h-4 min-w-0 gap-[2px]" style={{ width: `${Math.max((total / max) * 100, total > 0 ? 2 : 0)}%` }}>
              {row.segments.filter((s) => s.value > 0).map((segment) => (
                <button
                  aria-label={`${row.label}: ${segment.label} ${segment.value}. Open records.`}
                  className="h-full min-w-[3px] rounded-[3px] transition-[filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-task-accent"
                  key={segment.key}
                  onClick={() => onSelect(row.id, segment.key)}
                  style={{ ...swatchStyle(segment.key), flexGrow: segment.value, flexBasis: 0 }}
                  title={`${row.label} · ${segment.label}: ${segment.value} of ${total}`}
                  type="button"
                />
              ))}
            </span>
            <span className="text-right text-xs tabular-nums text-task-text-muted">{total}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ------------------------------------------------------------------------------------ score bars

/**
 * Signed scores run from 0 (everything done) to -100. Bars grow left-to-right by magnitude so
 * the worst stands out; the printed value keeps the true minus sign. "No data" is never drawn.
 */
export function ScoreBars({ rows, onSelect }: { rows: Array<{ id: string; label: string; score: number | null; basis: string }>; onSelect: (id: string) => void }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-task-text-muted">No employees with assigned work.</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            className="grid min-h-9 w-full grid-cols-[minmax(6rem,11rem)_1fr_4.25rem] items-center gap-3 rounded-lg px-1 text-left hover:bg-task-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-task-accent"
            onClick={() => onSelect(row.id)}
            title={`${row.label}: ${formatTaskPerformanceScore(row.score)} (${row.basis})`}
            type="button"
          >
            <span className="truncate text-sm">{row.label}</span>
            <span className="relative h-2.5 rounded-full bg-task-muted">
              {row.score !== null ? (
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(Math.abs(row.score), 100)}%`, backgroundColor: v("task-overdue", 0.85) }} />
              ) : null}
            </span>
            <span className={`text-right text-xs tabular-nums ${row.score === null ? "text-task-text-muted" : "font-semibold text-task-overdue"}`}>{formatTaskPerformanceScore(row.score)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------------------------ trend

export type TrendColumn = { label: string; title: string; segments: Array<{ key: string; label: string; value: number }> };

/** Stacked columns on one y-scale (cohort by deadline). */
export function TrendColumns({ columns }: { columns: TrendColumn[] }) {
  const max = Math.max(1, ...columns.map((c) => c.segments.reduce((sum, s) => sum + s.value, 0)));
  const step = Math.max(1, Math.ceil(columns.length / 8));
  if (!columns.length) return <p className="py-6 text-center text-sm text-task-text-muted">No work due in this period.</p>;
  return (
    <div>
      <div aria-label="Assigned work by deadline, split by outcome" className="flex h-44 items-end gap-[2px] border-b border-task-border" role="img">
        {columns.map((column) => {
          const total = column.segments.reduce((sum, s) => sum + s.value, 0);
          return (
            <div
              className="group relative flex h-full min-w-0 flex-1 flex-col-reverse justify-start gap-[2px]"
              key={column.title}
              title={`${column.title}: ${column.segments.map((s) => `${s.label} ${s.value}`).join(", ")} (due ${total})`}
            >
              {column.segments.filter((s) => s.value > 0).map((segment, index, list) => (
                <span
                  className={`w-full ${index === list.length - 1 ? "rounded-t-[4px]" : ""} group-hover:brightness-110`}
                  key={segment.key}
                  style={{ ...swatchStyle(segment.key), height: `${(segment.value / max) * 100}%`, minHeight: 2 }}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[2px] text-[0.625rem] text-task-text-muted">
        {columns.map((column, index) => (
          <span className="min-w-0 flex-1 truncate text-center" key={column.title}>{index % step === 0 ? column.label : ""}</span>
        ))}
      </div>
    </div>
  );
}
