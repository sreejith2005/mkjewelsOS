import { MessageCircleQuestion } from "lucide-react";
import { formatQuotaLabel, formatQuotaReset, isQuotaExhausted, type KiaraQuota } from "@jewelos/core";

/** "7 of 10 questions left today" with the reset time; "Unlimited questions" for Super Admin. */
export function QuotaChip({ quota }: { quota: KiaraQuota | null }) {
  if (!quota) return null;
  const exhausted = isQuotaExhausted(quota);
  const reset = quota.limit === null ? null : formatQuotaReset(quota);
  return <span
    aria-live="polite"
    className={exhausted
      ? "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-task-overdue/40 bg-task-overdue/10 px-3 text-xs font-semibold text-task-overdue"
      : "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-task-border bg-task-muted px-3 text-xs font-semibold text-task-text"}
    title={reset ? `Resets at ${reset}` : undefined}
  >
    <MessageCircleQuestion aria-hidden className="size-3.5" />
    {formatQuotaLabel(quota)}
    {reset ? <span className="font-normal text-task-text-muted">· resets {reset}</span> : null}
  </span>;
}
