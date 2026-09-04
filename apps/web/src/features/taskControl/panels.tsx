import type { ReactNode } from "react";
import { completionRate, type ProgressCounts } from "./filters";

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

/** The completion share, with the overdue share of the same bar called out in red. */
export function CompletionBar({ row }: { row: ProgressCounts }) {
  const done = completionRate(row);
  const late = row.assigned === 0 ? 0 : Math.round((row.overdue / row.assigned) * 100);
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-task-muted">
        <span className="flex h-full">
          <span className="h-full bg-success" style={{ width: `${done}%` }} />
          <span className="h-full bg-task-overdue" style={{ width: `${Math.min(late, 100 - done)}%` }} />
        </span>
      </span>
      <span className="tabular-nums text-task-text-muted">{done}%</span>
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
            {[...columns, "Assigned", "Completed", "Remaining", "Overdue", "Rate"].map((column) => (
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
              <td className="px-2 py-2"><CompletionBar row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
