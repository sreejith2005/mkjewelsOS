import { materializeRecurringSchedule as materializeCoreRecurringSchedule } from "../../../packages/core/src/recurrence.ts";

export type ImmediateRecurringTemplate = Readonly<{
  id: string;
  recurrence_rule: string | null;
  schedule_kind: string;
  starts_on: string | null;
}>;

export type ImmediateRecurringGateway = Readonly<{
  create: (templateId: string) => Promise<string | null>;
}>;

export type ImmediateRecurringOutcome = Readonly<{
  alreadyExists: number;
  created: number;
  eligible: number;
  failed: number;
}>;

const notDue: ImmediateRecurringOutcome = {
  alreadyExists: 0,
  created: 0,
  eligible: 0,
  failed: 0,
};

/** Only creates the occurrence for a schedule that is actually due today. */
export async function materializeRecurringSchedule(
  gateway: ImmediateRecurringGateway,
  template: ImmediateRecurringTemplate,
  targetDate: string,
): Promise<ImmediateRecurringOutcome> {
  if (template.schedule_kind === "as_required") return notDue;

  if (template.schedule_kind === "one_time") {
    if (template.starts_on !== targetDate) return notDue;
    try {
      const taskId = await gateway.create(template.id);
      return {
        alreadyExists: taskId ? 0 : 1,
        created: taskId ? 1 : 0,
        eligible: 1,
        failed: 0,
      };
    } catch {
      return { alreadyExists: 0, created: 0, eligible: 1, failed: 1 };
    }
  }

  if (!template.recurrence_rule) return notDue;
  return materializeCoreRecurringSchedule(
    { id: template.id, recurrenceRule: template.recurrence_rule, startsOn: template.starts_on },
    targetDate,
    (dueTemplate) => gateway.create(dueTemplate.id),
  );
}
