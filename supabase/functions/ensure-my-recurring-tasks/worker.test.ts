import { assertEquals } from "@std/assert";
import { ensureMyRecurringTasks, type RecurringTaskGateway } from "./worker.ts";

Deno.test("materializes only the signed-in employee's schedules that are due today", async () => {
  const created: string[] = [];
  const gateway: RecurringTaskGateway = {
    create: async (templateId) => { created.push(templateId); return templateId; },
    listTemplates: async () => [
      { id: "daily", recurrence_rule: "FREQ=DAILY", schedule_kind: "daily", starts_on: "2026-08-01" },
      { id: "fortnightly", recurrence_rule: "FREQ=WEEKLY;INTERVAL=2", schedule_kind: "weekly", starts_on: "2026-08-03" },
      { id: "future", recurrence_rule: "FREQ=DAILY", schedule_kind: "daily", starts_on: "2026-08-11" },
    ],
  };

  assertEquals(await ensureMyRecurringTasks(gateway, "2026-08-10"), { created: 1, alreadyExists: 0, eligible: 1 });
  assertEquals(created, ["daily"]);
});
