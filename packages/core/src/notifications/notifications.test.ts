import { describe, expect, it } from "vitest";
import {
  buildDeliveryIdempotencyKey,
  buildEventIdempotencyKey,
  calculateRetryAt,
  canClaimDelivery,
  canManuallyRetry,
  conditionsMatch,
  cooldownEligible,
  evaluateCondition,
  isDeliveryState,
  isSafeInternalLink,
  parseTemplateVariables,
  recipientResolutionRequests,
  renderTemplate,
  ruleMatches,
  selectChannels,
  validateRule,
  validateTemplateText,
  type NotificationRuleInput,
} from "./index";

const now = new Date("2026-08-10T10:00:00.000Z");
const baseRule: NotificationRuleInput = {
  eventType: "task_assigned",
  conditions: [],
  channels: ["in_app"],
  recipients: [{ type: "assigned_users" }],
  delayMinutes: 0,
  cooldownMinutes: 0,
  maxAttempts: 3,
  backoffMinutes: 5,
};

describe("notification templates", () => {
  it("parses and deduplicates placeholders", () => expect(parseTemplateVariables("{{task_title}} {{task_title}} {{priority}}")).toEqual(["task_title", "priority"]));
  it("renders allowlisted placeholders", () => expect(renderTemplate("Task {{task_title}}", { task_title: "Count stock" })).toBe("Task Count stock"));
  it("fails when a required value is missing", () => expect(() => renderTemplate("Task {{task_title}}", {})).toThrow("Missing template variables"));
  it("rejects unknown variables", () => expect(validateTemplateText("task_assigned", "{{client_name}}", "Body").errors).toContain("Unknown variables: client_name"));
  it("rejects malformed placeholders", () => expect(validateTemplateText("task_assigned", "Task", "{{task_title}").valid).toBe(false));
  it("rejects empty and excessive text", () => expect(validateTemplateText("system_alert", "", "").errors).toHaveLength(2));
});

describe("notification conditions", () => {
  const payload = { text: "High priority", number: 5, empty: "", today: "2026-08-10", past: "2026-08-09T00:00:00Z", future: "2026-08-11T00:00:00Z" };
  const cases = [
    ["equals", "number", 5], ["not_equals", "number", 6], ["contains", "text", "priority"],
    ["greater_than", "number", 4], ["greater_than_or_equal", "number", 5], ["less_than", "number", 6],
    ["less_than_or_equal", "number", 5], ["is_empty", "empty", undefined], ["is_not_empty", "text", undefined],
    ["is_today", "today", undefined], ["is_past", "past", undefined], ["is_future", "future", undefined],
  ] as const;
  it.each(cases)("evaluates %s", (operator, field, value) => expect(evaluateCondition({ operator, field, value }, payload, now)).toBe(true));
  it("uses deterministic AND semantics", () => expect(conditionsMatch([{ field: "number", operator: "equals", value: 5 }, { field: "text", operator: "contains", value: "missing" }], payload, now)).toBe(false));
});

describe("notification rules", () => {
  it("matches a valid event rule", () => expect(ruleMatches({ ...baseRule, conditions: [{ field: "priority", operator: "equals", value: "high" }] }, "task_assigned", { priority: "high" }, now)).toBe(true));
  it("rejects fields outside the event allowlist", () => expect(validateRule({ ...baseRule, conditions: [{ field: "client_phone", operator: "equals", value: "x" }] })[0]).toContain("not allowed"));
  it("validates retry bounds", () => expect(validateRule({ ...baseRule, maxAttempts: 11 })).toContain("Max attempts must be between 1 and 10"));
  it("selects only available unique channels", () => expect(selectChannels(["in_app", "email", "in_app"], { in_app: true, email: false, whatsapp: false, sms: false, push: false })).toEqual(["in_app"]));
  it("deduplicates recipient resolution requests", () => expect(recipientResolutionRequests([{ type: "actor" }, { type: "actor" }])).toHaveLength(1));
});

describe("notification delivery", () => {
  it("calculates capped exponential backoff", () => expect(calculateRetryAt(4, 10, now, 60).toISOString()).toBe("2026-08-10T11:00:00.000Z"));
  it("checks cooldown eligibility", () => expect(cooldownEligible(new Date("2026-08-10T09:31:00Z"), 30, now)).toBe(false));
  it("builds stable idempotency keys", () => expect(buildDeliveryIdempotencyKey("event", "rule", "user", "in_app")).toBe("event:rule:user:in_app"));
  it("normalizes event idempotency keys", () => expect(buildEventIdempotencyKey("task_completed", "Tasks", "ABC", "1")).toBe("task_completed:tasks:abc:1"));
  it("recognizes claim and retry states", () => { expect(canClaimDelivery("retry_wait")).toBe(true); expect(canManuallyRetry("failed_terminal")).toBe(true); expect(isDeliveryState("delivered")).toBe(true); });
  it("accepts safe internal links", () => expect(isSafeInternalLink("/tasks/checklist?id=1")).toBe(true));
  it.each(["https://evil.example", "//evil.example", "/safe\\evil", "/bad\npath"])("rejects unsafe link %s", (link) => expect(isSafeInternalLink(link)).toBe(false));
});
