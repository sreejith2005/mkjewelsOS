import { isSafeInternalLink, validateRule, validateTemplateText, type NotificationEventType } from "@jewelos/core";
import type { RuleDraft } from "./types";

/**
 * The draft adapters the notification administration forms run before saving.
 * They only reshape a form draft for the `@jewelos/core` rules, which stay the
 * single source; the web `features/notifications/viewModel.ts` wraps the same
 * core calls the same way.
 */
export function validateTemplateDraft(eventType: NotificationEventType, title: string, body: string, link: string | null): readonly string[] {
  const validation = validateTemplateText(eventType, title, body);
  return [...validation.errors, ...(isSafeInternalLink(link) ? [] : ["Link must be a safe internal path"])];
}

export function validateRuleDraft(draft: RuleDraft): readonly string[] {
  return validateRule({
    eventType: draft.eventType,
    conditions: draft.conditions.map((condition) => ({ ...condition, operator: condition.operator as never })),
    channels: Object.keys(draft.channelTemplates) as never,
    recipients: draft.recipients,
    delayMinutes: draft.delayMinutes,
    cooldownMinutes: draft.cooldownMinutes,
    maxAttempts: draft.maxAttempts,
    backoffMinutes: draft.backoffMinutes,
  });
}

/** Only a terminal failure or a configuration block may be retried. */
export function deliveryCanRetry(state: string): boolean {
  return state === "failed_terminal" || state === "blocked_configuration";
}
