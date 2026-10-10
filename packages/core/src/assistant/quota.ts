import { zonedDateKey } from "../voiceDeadline.ts";

/** The daily question allowance as `get_my_kiara_quota()` reports it. */
export type KiaraQuota = Readonly<{
  used: number;
  /** null means unlimited (Super Admin, or a per-user exception). */
  limit: number | null;
  resets_at: string;
  timezone?: string | undefined;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseKiaraQuota(input: unknown): KiaraQuota | null {
  if (!isRecord(input)) return null;
  const { used, limit, resets_at: resetsAt, timezone } = input;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0) return null;
  if (limit !== null && (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0)) return null;
  if (typeof resetsAt !== "string" || Number.isNaN(Date.parse(resetsAt))) return null;
  return { used, limit, resets_at: resetsAt, timezone: typeof timezone === "string" ? timezone : undefined };
}

export function quotaRemaining(quota: KiaraQuota): number | null {
  return quota.limit === null ? null : Math.max(0, quota.limit - quota.used);
}

export function isQuotaExhausted(quota: KiaraQuota): boolean {
  const remaining = quotaRemaining(quota);
  return remaining !== null && remaining <= 0;
}

/** "7 of 10 questions left today", or "Unlimited questions". */
export function formatQuotaLabel(quota: KiaraQuota): string {
  const remaining = quotaRemaining(quota);
  if (remaining === null) return "Unlimited questions";
  return `${remaining} of ${quota.limit} ${quota.limit === 1 ? "question" : "questions"} left today`;
}

/** The reset moment in the tenant's timezone, e.g. "12:00 am on 10 Oct". */
export function formatQuotaReset(quota: KiaraQuota, fallbackTimeZone = "Asia/Kolkata"): string {
  const timeZone = quota.timezone ?? fallbackTimeZone;
  const at = new Date(quota.resets_at);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(at);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(at);
  return `${time} on ${day}`;
}

/**
 * The quota day: the calendar date in the tenant's timezone. Mirrors
 * `kiara_quota_for()` in migration 0208, which is the authority.
 */
export function kiaraQuotaDate(now: Date, timeZone: string): string {
  return zonedDateKey(now, timeZone);
}
