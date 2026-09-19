import type { ReactNode } from "react";
import { formatTaskPerformanceScore, TASK_DELAYED_SCORE_LABEL, TASK_PENDING_SCORE_LABEL } from "@jewelos/core";
import { delayedScore, pendingScore, type ProgressCounts } from "./filters";

export function StatTile({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const valueTone = tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-task-overdue" : "text-task-text";
  return (
    <div className="rounded-xl border border-task-border bg-task-bg p-4">
      <p className="text-xs text-task-text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueTone}`}>{value}</p>
      <p className="mt-1 text-[0.6875rem] text-task-text-muted">{hint}</p>
    </div>
  );
}

/** A task performance score, always in the danger colour; "No data" stays muted. */
export function ScoreText({ value, className = "" }: { value: number | null; className?: string }) {
  return (
    <span className={`tabular-nums ${value === null ? "text-task-text-muted" : "font-semibold text-task-overdue"} ${className}`}>
      {formatTaskPerformanceScore(value)}
    </span>
  );
}

export function ProgressTable<T extends ProgressCounts>({
  rows,
  columns,
  head,
  empty,
  onSelect,
}: {
  rows: readonly T[];
  columns: readonly string[];
  head: (row: T) => ReactNode;
  empty: string;
  onSelect?: (row: T) => void;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-task-text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-task-text-muted">
          <tr>
            {[...columns, "Assigned", "Completed", "Remaining", "Overdue", TASK_PENDING_SCORE_LABEL, TASK_DELAYED_SCORE_LABEL].map((column) => (
              <th className="whitespace-nowrap px-2 py-2 font-semibold" key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              className={`border-t border-task-border ${onSelect ? "cursor-pointer hover:bg-gold/5" : ""}`}
              key={index}
              onClick={onSelect ? () => onSelect(row) : undefined}
            >
              {head(row)}
              <td className="px-2 py-2 tabular-nums">{row.assigned}</td>
              <td className="px-2 py-2 tabular-nums text-success">{row.completed}</td>
              <td className="px-2 py-2 tabular-nums">{row.remaining}</td>
              <td className={`px-2 py-2 tabular-nums ${row.overdue > 0 ? "font-semibold text-task-overdue" : "text-task-text-muted"}`}>{row.overdue}</td>
              <td className="whitespace-nowrap px-2 py-2"><ScoreText value={pendingScore(row)} /></td>
              <td className="whitespace-nowrap px-2 py-2"><ScoreText value={delayedScore(row)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
