import { assertEquals } from "@std/assert";
import { materializeRecurringSchedule, type ImmediateRecurringGateway } from "./worker.ts";

Deno.test("materializes a daily schedule that is due on the date it is saved", async () => {
  const created: string[] = [];
  const gateway: ImmediateRecurringGateway = {
    create: async (templateId) => {
      created.push(templateId);
      return templateId;
    },
  };

  const result = await materializeRecurringSchedule(
    gateway,
    { id: "daily", recurrence_rule: "FREQ=DAILY", schedule_kind: "daily", starts_on: "2026-08-24" },
    "2026-08-25",
  );

  assertEquals(result, { alreadyExists: 0, created: 1, eligible: 1, failed: 0 });
  assertEquals(created, ["daily"]);
});

Deno.test("does not create an occurrence for a weekly schedule before its next due date", async () => {
  const gateway: ImmediateRecurringGateway = {
    create: async () => {
      throw new Error("the schedule is not due");
    },
  };

  const result = await materializeRecurringSchedule(
    gateway,
    { id: "weekly", recurrence_rule: "FREQ=WEEKLY", schedule_kind: "weekly", starts_on: "2026-08-24" },
    "2026-08-25",
  );

  assertEquals(result, { alreadyExists: 0, created: 0, eligible: 0, failed: 0 });
});
