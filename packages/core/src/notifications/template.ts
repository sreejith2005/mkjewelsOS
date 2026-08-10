import { EVENT_VARIABLES, type NotificationEventType } from "./events";

const PLACEHOLDER = /\{\{([a-z][a-z0-9_]*)\}\}/g;
const ANY_BRACES = /\{\{|\}\}/;

export type TemplateValidation = Readonly<{ valid: boolean; errors: readonly string[]; variables: readonly string[] }>;

export function parseTemplateVariables(template: string): readonly string[] {
  const variables: string[] = [];
  let match: RegExpExecArray | null;
  PLACEHOLDER.lastIndex = 0;
  while ((match = PLACEHOLDER.exec(template)) !== null) variables.push(match[1]!);
  return [...new Set(variables)];
}

export function validateTemplateText(
  eventType: NotificationEventType,
  title: string,
  body: string,
): TemplateValidation {
  const errors: string[] = [];
  const combined = `${title}\n${body}`;
  const variables = parseTemplateVariables(combined);
  const stripped = combined.replace(PLACEHOLDER, "");
  if (!title.trim()) errors.push("Title is required");
  if (!body.trim()) errors.push("Body is required");
  if (title.length > 200) errors.push("Title must be 200 characters or fewer");
  if (body.length > 4000) errors.push("Body must be 4000 characters or fewer");
  if (ANY_BRACES.test(stripped)) errors.push("Template contains a malformed placeholder");
  const allowed = new Set(EVENT_VARIABLES[eventType]);
  const unknown = variables.filter((variable) => !allowed.has(variable));
  if (unknown.length) errors.push(`Unknown variables: ${unknown.join(", ")}`);
  return { valid: errors.length === 0, errors, variables };
}

export function renderTemplate(template: string, values: Readonly<Record<string, unknown>>): string {
  const missing: string[] = [];
  PLACEHOLDER.lastIndex = 0;
  const rendered = template.replace(PLACEHOLDER, (_whole, key: string) => {
    const value = values[key];
    if (value === undefined || value === null || value === "") {
      missing.push(key);
      return "";
    }
    return String(value);
  });
  if (missing.length) throw new Error(`Missing template variables: ${[...new Set(missing)].join(", ")}`);
  if (ANY_BRACES.test(rendered)) throw new Error("Template contains an unresolved or malformed placeholder");
  return rendered;
}
