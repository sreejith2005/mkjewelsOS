import { AlertTriangle } from "lucide-react";
import { describeSheetSyncError, SHEET_STALE_AFTER_MS, type CustomerListFilterOptions } from "@jewelos/core";
import { formatDateTime } from "@/features/customers/format";

type ImportItem = CustomerListFilterOptions["import"][number];

/**
 * Which sheets could not be read, why, since when, and what to do. Also warns
 * about a scheduled sheet that has not been read for a while even without an
 * error (owner, 2026-11-27: the old one-line notice never said which sheet).
 */
export function SheetReadProblems({ items, now = Date.now() }: Readonly<{ items: readonly ImportItem[]; now?: number }>) {
  const failed = items.filter((item) => item.failed);
  const stale = items.filter((item) => !item.failed && item.scheduled && item.last_run_at && now - Date.parse(item.last_run_at) > SHEET_STALE_AFTER_MS);
  if (!failed.length && !stale.length) return null;
  const count = failed.length + stale.length;
  return (
    <details className="mt-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm" open={count <= 2}>
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-danger">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" />
        {failed.length ? `${failed.length} sheet${failed.length === 1 ? "" : "s"} could not be read` : ""}
        {failed.length && stale.length ? "; " : ""}
        {stale.length ? `${stale.length} sheet${stale.length === 1 ? " has" : "s have"} not been read for over 2 hours` : ""}
        . The list shows what was read before.
      </summary>
      <ul className="mt-2 space-y-3">
        {failed.map((item) => {
          const { problem, fix } = describeSheetSyncError(item.error);
          return (
            <li key={item.source} className="border-t border-danger/20 pt-2">
              <p className="font-semibold text-task-text">{item.label ?? item.source}</p>
              <p className="text-task-text">{problem}</p>
              <p className="text-task-text-muted"><span className="font-medium text-task-text">What to do: </span>{fix}</p>
              <p className="text-xs text-task-text-muted">
                {item.error_since ? `Failing since ${formatDateTime(item.error_since)}. ` : ""}
                {item.last_ok_at ? `Last good read ${formatDateTime(item.last_ok_at)}. ` : "No good read recorded yet. "}
                {item.last_run_at ? `Last try ${formatDateTime(item.last_run_at)}. ` : ""}
                Code: <code>{item.error ?? "unknown"}</code> ({item.source})
              </p>
            </li>
          );
        })}
        {stale.map((item) => (
          <li key={item.source} className="border-t border-danger/20 pt-2">
            <p className="font-semibold text-task-text">{item.label ?? item.source}</p>
            <p className="text-task-text">Not read since {formatDateTime(item.last_run_at!)}, with no error recorded.</p>
            <p className="text-task-text-muted"><span className="font-medium text-task-text">What to do: </span>The 5-minute sheet sync may have stopped. Tell the developer; it is usually the scheduled job or its secret.</p>
            <p className="text-xs text-task-text-muted">Code: <code>not_read_recently</code> ({item.source})</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
