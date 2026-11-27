import { AlertTriangle } from "lucide-react";
import { describeSheetSyncError, SHEET_STALE_AFTER_MS, type CustomerListFilterOptions } from "@jewelos/core";
import { formatDateTime } from "@/features/customers/format";

type ImportItem = CustomerListFilterOptions["import"][number];

/**
 * Which sheets could not be read, why, since when, and what to do. Also warns
 * about a scheduled sheet that has not been read for a while even without an
 * error (owner, 2026-11-27: the old one-line notice never said which sheet).
 * A small line, closed by default; the details open on a tap.
 */
export function SheetReadProblems({ items, now = Date.now() }: Readonly<{ items: readonly ImportItem[]; now?: number }>) {
  const failed = items.filter((item) => item.failed);
  const stale = items.filter((item) => !item.failed && item.scheduled && item.last_run_at && now - Date.parse(item.last_run_at) > SHEET_STALE_AFTER_MS);
  if (!failed.length && !stale.length) return null;
  const count = failed.length + stale.length;
  return (
    <details className="group mt-1 text-xs text-task-text-muted">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-1 hover:text-task-text">
        <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0 text-gold" />
        {count} sheet{count === 1 ? " needs" : "s need"} attention
        <span className="underline underline-offset-2 group-open:hidden">Details</span>
        <span className="hidden underline underline-offset-2 group-open:inline">Hide</span>
      </summary>
      <p className="mt-1">The list shows what was read before.</p>
      <ul className="mt-2 max-w-2xl space-y-3 rounded-lg border border-task-border p-3 text-sm">
        {failed.map((item) => {
          const { problem, fix } = describeSheetSyncError(item.error);
          return (
            <li key={item.source} className="border-t border-task-border pt-2 first:border-t-0 first:pt-0">
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
          <li key={item.source} className="border-t border-task-border pt-2 first:border-t-0 first:pt-0">
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
