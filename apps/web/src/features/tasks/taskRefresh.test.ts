import { describe, expect, it } from "vitest";
import { prepareRecurringTasksThenLoad } from "./taskRefresh";

describe("prepareRecurringTasksThenLoad", () => {
  it("loads persisted tasks when optional recurrence preparation fails", async () => {
    const tasks = await prepareRecurringTasksThenLoad(
      async () => { throw new Error("Edge Function returned a non-2xx status code"); },
      async () => ["today-task"],
    );

    expect(tasks).toEqual(["today-task"]);
  });
});
