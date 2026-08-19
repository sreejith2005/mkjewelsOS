export const CONDITION_OPERATORS = [
  "equals", "not_equals", "contains", "greater_than", "greater_than_or_equal",
  "less_than", "less_than_or_equal", "is_empty", "is_not_empty", "is_today",
  "is_past", "is_future",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];
export type NotificationCondition = Readonly<{ field: string; operator: ConditionOperator; value?: unknown }>;

function dateOnly(now: Date): string { return now.toISOString().slice(0, 10); }
function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateCondition(
  condition: NotificationCondition,
  payload: Readonly<Record<string, unknown>>,
  now = new Date(),
): boolean {
  const actual = payload[condition.field];
  const expected = condition.value;
  switch (condition.operator) {
    case "equals": return actual === expected || String(actual) === String(expected);
    case "not_equals": return !(actual === expected || String(actual) === String(expected));
    case "contains": return Array.isArray(actual)
      ? actual.some((item) => String(item) === String(expected))
      : String(actual ?? "").toLocaleLowerCase().includes(String(expected ?? "").toLocaleLowerCase());
    case "greater_than": { const a = number(actual); const b = number(expected); return a !== null && b !== null && a > b; }
    case "greater_than_or_equal": { const a = number(actual); const b = number(expected); return a !== null && b !== null && a >= b; }
    case "less_than": { const a = number(actual); const b = number(expected); return a !== null && b !== null && a < b; }
    case "less_than_or_equal": { const a = number(actual); const b = number(expected); return a !== null && b !== null && a <= b; }
    case "is_empty": return actual === undefined || actual === null || actual === "" || (Array.isArray(actual) && actual.length === 0);
    case "is_not_empty": return !evaluateCondition({ ...condition, operator: "is_empty" }, payload, now);
    case "is_today": return typeof actual === "string" && actual.slice(0, 10) === dateOnly(now);
    case "is_past": { const time = typeof actual === "string" ? Date.parse(actual) : Number.NaN; return Number.isFinite(time) && time < now.getTime(); }
    case "is_future": { const time = typeof actual === "string" ? Date.parse(actual) : Number.NaN; return Number.isFinite(time) && time > now.getTime(); }
  }
}

export function conditionsMatch(
  conditions: readonly NotificationCondition[],
  payload: Readonly<Record<string, unknown>>,
  now = new Date(),
): boolean {
  return conditions.every((condition) => evaluateCondition(condition, payload, now));
}
