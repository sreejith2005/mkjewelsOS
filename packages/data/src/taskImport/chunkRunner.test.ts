import { describe, expect, it, vi } from "vitest";
import { runTaskImportChunks } from "./chunkRunner";

describe("resumable task import chunks", () => {
  it("commits at most 100 rows per request and reports cumulative progress", async () => {
    const commit = vi.fn(async (_batch: string, rows: readonly unknown[]) => ({ created: rows.length, rejected: 0, replayed: 0, outcome: "in_progress", issues: [] }));
    const progress: number[] = [];
    const result = await runTaskImportChunks("batch", Array.from({ length: 205 }, (_, source_row) => ({ source_row })), commit, (done) => progress.push(done));
    expect(commit.mock.calls.map((call) => call[1])).toHaveLength(3);
    expect(commit.mock.calls.map((call) => call[1].length)).toEqual([100, 100, 5]);
    expect(progress).toEqual([100, 200, 205]);
    expect(result.created).toBe(205);
  });

  it("keeps the newest batch-cumulative Assigning Left total instead of adding chunk totals together", async () => {
    let running = 0;
    const commit = vi.fn(async (_batch: string, rows: readonly unknown[]) => {
      running += rows.length;
      return { created: rows.length, rejected: 0, replayed: 0, assigning_left_count: running, outcome: "in_progress", issues: [] };
    });
    const result = await runTaskImportChunks("batch", Array.from({ length: 205 }, (_, source_row) => ({ source_row })), commit, () => {});
    expect(result.assigningLeft).toBe(205);
  });
});
