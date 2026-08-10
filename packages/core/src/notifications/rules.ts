import { CONDITION_OPERATORS, conditionsMatch, type NotificationCondition } from "./conditions";
import { EVENT_VARIABLES, NOTIFICATION_CHANNELS, type NotificationChannel, type NotificationEventType } from "./events";

export const RECIPIENT_TYPES = [
  "assigned_users", "task_creator", "instance_starter", "form_submitter", "reviewer",
  "actor", "branch_manager", "department_head", "manager", "specified_users", "specified_role",
] as const;
export type RecipientType = (typeof RECIPIENT_TYPES)[number];
export type RecipientRule = Readonly<{ type: RecipientType; userIds?: readonly string[]; role?: string }>;
export type NotificationRuleInput = Readonly<{
  eventType: NotificationEventType;
  conditions: readonly NotificationCondition[];
  channels: readonly NotificationChannel[];
  recipients: readonly RecipientRule[];
  delayMinutes: number;
  cooldownMinutes: number;
  maxAttempts: number;
  backoffMinutes: number;
}>;

export function validateRule(rule: NotificationRuleInput): readonly string[] {
  const errors: string[] = [];
  const allowedFields = new Set(EVENT_VARIABLES[rule.eventType]);
  if (!rule.channels.length) errors.push("At least one channel is required");
  if (!rule.recipients.length) errors.push("At least one recipient rule is required");
  if (rule.delayMinutes < 0 || rule.delayMinutes > 43_200) errors.push("Delay must be between 0 and 43200 minutes");
  if (rule.cooldownMinutes < 0 || rule.cooldownMinutes > 525_600) errors.push("Cooldown is outside the supported range");
  if (!Number.isInteger(rule.maxAttempts) || rule.maxAttempts < 1 || rule.maxAttempts > 10) errors.push("Max attempts must be between 1 and 10");
  if (rule.backoffMinutes < 1 || rule.backoffMinutes > 1_440) errors.push("Backoff must be between 1 and 1440 minutes");
  for (const channel of rule.channels) if (!(NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) errors.push(`Unsupported channel: ${channel}`);
  for (const condition of rule.conditions) {
    if (!allowedFields.has(condition.field)) errors.push(`Condition field is not allowed for ${rule.eventType}: ${condition.field}`);
    if (!(CONDITION_OPERATORS as readonly string[]).includes(condition.operator)) errors.push(`Unsupported condition operator: ${condition.operator}`);
  }
  for (const recipient of rule.recipients) {
    if (!(RECIPIENT_TYPES as readonly string[]).includes(recipient.type)) errors.push(`Unsupported recipient rule: ${recipient.type}`);
    if (recipient.type === "specified_users" && !recipient.userIds?.length) errors.push("Specified users cannot be empty");
    if (recipient.type === "specified_role" && !recipient.role) errors.push("Specified role is required");
  }
  return [...new Set(errors)];
}

export function ruleMatches(rule: NotificationRuleInput, eventType: NotificationEventType, payload: Readonly<Record<string, unknown>>, now = new Date()): boolean {
  return rule.eventType === eventType && validateRule(rule).length === 0 && conditionsMatch(rule.conditions, payload, now);
}

export function selectChannels(requested: readonly NotificationChannel[], available: Readonly<Record<NotificationChannel, boolean>>): readonly NotificationChannel[] {
  return [...new Set(requested)].filter((channel) => available[channel]);
}

export function recipientResolutionRequests(recipients: readonly RecipientRule[]): readonly RecipientRule[] {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = JSON.stringify({ ...recipient, userIds: recipient.userIds ? [...recipient.userIds].sort() : undefined });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
