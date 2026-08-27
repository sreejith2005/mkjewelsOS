import { describe, expect, it, vi } from "vitest";
import { prepareRecurringTasksThenLoad } from "./taskRefresh";

describe("prepareRecurringTasksThenLoad", () => {
  it("loads persisted tasks without waiting for recurring preparation", async () => {
    let resolvePreparation: (() => void) | undefined;
    const preparation = new Promise<void>((resolve) => { resolvePreparation = resolve; });

    await expect(prepareRecurringTasksThenLoad(
      async () => { await preparation; return { created: 0 }; },
      async () => ["newly-assigned-task"],
    )).resolves.toEqual(["newly-assigned-task"]);

    resolvePreparation?.();
  });

  it("loads persisted tasks when optional recurrence preparation fails", async () => {
    const tasks = await prepareRecurringTasksThenLoad(
      async () => { throw new Error("Edge Function returned a non-2xx status code"); },
      async () => ["today-task"],
    );

    expect(tasks).toEqual(["today-task"]);
  });

  it("reloads the task feed after a due recurring occurrence is created", async () => {
    let resolvePreparation: ((value: { created: number }) => void) | undefined;
    const preparation = new Promise<{ created: number }>((resolve) => { resolvePreparation = resolve; });
    const loads = [["yesterday-overdue"], ["yesterday-overdue", "today-pending"]];
    const refreshed: string[][] = [];

    const initial = await prepareRecurringTasksThenLoad(
      async () => preparation,
      async () => loads.shift() ?? [],
      (tasks) => { refreshed.push(tasks); },
    );

    expect(initial).toEqual(["yesterday-overdue"]);
    resolvePreparation?.({ created: 1 });
    await vi.waitFor(() => expect(refreshed).toEqual([["yesterday-overdue", "today-pending"]]));
  });
});
