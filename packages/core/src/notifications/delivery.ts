import { DELIVERY_STATES, type DeliveryState, type NotificationChannel, type NotificationEventType } from "./events";

export function isDeliveryState(value: string): value is DeliveryState {
  return (DELIVERY_STATES as readonly string[]).includes(value);
}

export function canClaimDelivery(state: DeliveryState): boolean {
  return state === "pending" || state === "scheduled" || state === "retry_wait" || state === "processing";
}

export function canManuallyRetry(state: DeliveryState): boolean {
  return state === "failed_terminal" || state === "blocked_configuration";
}

export function calculateRetryAt(attempt: number, baseMinutes: number, now = new Date(), maximumMinutes = 1_440): Date {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("Attempt must be a positive integer");
  const minutes = Math.min(maximumMinutes, baseMinutes * (2 ** (attempt - 1)));
  return new Date(now.getTime() + minutes * 60_000);
}

export function cooldownEligible(lastDeliveredAt: Date | null, cooldownMinutes: number, now = new Date()): boolean {
  return !lastDeliveredAt || now.getTime() >= lastDeliveredAt.getTime() + cooldownMinutes * 60_000;
}

export function buildDeliveryIdempotencyKey(eventKey: string, ruleId: string, recipientId: string, channel: NotificationChannel): string {
  return `${eventKey}:${ruleId}:${recipientId}:${channel}`;
}

export function buildEventIdempotencyKey(eventType: NotificationEventType, sourceModule: string, sourceRecordId: string, occurrence: string): string {
  return `${eventType}:${sourceModule}:${sourceRecordId}:${occurrence}`.toLocaleLowerCase();
}

export function isSafeInternalLink(value: string | null | undefined): boolean {
  if (!value) return true;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return false;
  try {
    const parsed = new URL(value, "https://jewelos.invalid");
    return parsed.origin === "https://jewelos.invalid" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
