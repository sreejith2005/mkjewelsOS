import { shouldGenerateRecurringTask } from "../../../packages/core/src/recurrence.ts";

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
): Promise<{ alreadyExists: number; created: number; eligible: number }> {
  let alreadyExists = 0;
  let created = 0;
  let eligible = 0;
  for (const template of await gateway.listTemplates()) {
    if (template.schedule_kind === "as_required" || !template.recurrence_rule) continue;
    try {
      if (!shouldGenerateRecurringTask(template.recurrence_rule, targetDate, template.starts_on ?? undefined)) continue;
    } catch {
      continue;
    }
    eligible += 1;
    if (await gateway.create(template.id)) created += 1;
    else alreadyExists += 1;
  }
  return { alreadyExists, created, eligible };
}
