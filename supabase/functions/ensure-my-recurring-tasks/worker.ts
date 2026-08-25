import { materializeDueRecurringTemplates } from "../../../packages/core/src/recurrence.ts";

export type DueRecurringTemplate = Readonly<{
  id: string;
  recurrence_rule: string;
  schedule_kind: string;
  starts_on: string | null;
}>;

export type RecurringTaskGateway = Readonly<{
  create: (templateId: string) => Promise<string | null>;
  listTemplates: () => Promise<readonly DueRecurringTemplate[]>;
}>;

export async function ensureMyRecurringTasks(
  gateway: RecurringTaskGateway,
  targetDate: string,
): Promise<{ alreadyExists: number; created: number; eligible: number; failed: number }> {
  const templates = (await gateway.listTemplates())
    .filter((template) => template.schedule_kind !== "as_required" && Boolean(template.recurrence_rule))
    .map((template) => ({
      id: template.id,
      recurrenceRule: template.recurrence_rule,
      startsOn: template.starts_on,
    }));
  return materializeDueRecurringTemplates(templates, targetDate, (template) => gateway.create(template.id));
}
