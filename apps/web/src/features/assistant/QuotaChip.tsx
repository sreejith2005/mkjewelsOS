import { MessageCircleQuestion } from "lucide-react";
import { formatQuotaLabel, formatQuotaReset, isQuotaExhausted, type KiaraQuota } from "@jewelos/core";

/**
 * "7 of 10 questions left today" with the reset time. People without a limit
 * (Super Admin, or an "unlimited" exception) see no chip at all.
 */
export function QuotaChip({ quota }: { quota: KiaraQuota | null }) {
  if (!quota || quota.limit === null) return null;
  const exhausted = isQuotaExhausted(quota);
  const reset = formatQuotaReset(quota);
  return <span
    aria-live="polite"
    className={exhausted
      ? "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-task-overdue/40 bg-task-overdue/10 px-3 text-xs font-semibold text-task-overdue"
      : "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-task-border bg-task-muted px-3 text-xs font-semibold text-task-text"}
    title={`Resets at ${reset}`}
  >
    <MessageCircleQuestion aria-hidden className="size-3.5" />
    {formatQuotaLabel(quota)}
    <span className="hidden font-normal text-task-text-muted sm:inline">· resets {reset}</span>
  </span>;
}
