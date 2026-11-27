/**
 * A Runo call can have a call log (Runo's record of the call) and an
 * interaction form (what the salesperson filled in after it). Migration 0446
 * joins both by callId into one interaction; these turn that into labels.
 */
export interface CustomerCallLog {
  readonly started_at?: string;
  readonly duration_seconds?: number;
  readonly type?: string;
  readonly tag?: string;
  readonly status?: string;
  readonly caller?: string;
}

/** "Call log + interaction form", "Call log only" or null for anything else. */
export function callPartsLabel(entry: Readonly<{ call?: CustomerCallLog | null; has_interaction_form?: boolean }>): string | null {
  if (!entry.call) return null;
  return entry.has_interaction_form ? "Call log + interaction form" : "Call log only (no interaction form)";
}

/** 95 -> "1 min 35 s"; 0 -> "0 s"; missing -> null. */
export function callDurationLabel(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60), rest = whole % 60;
  return minutes ? `${minutes} min${rest ? ` ${rest} s` : ""}` : `${rest} s`;
}

/** One line about the call: type, duration, tag/status. */
export function callSummary(call: CustomerCallLog | null | undefined): string | null {
  if (!call) return null;
  const parts = [call.type, callDurationLabel(call.duration_seconds), call.status ?? call.tag].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(" · ") : null;
}
