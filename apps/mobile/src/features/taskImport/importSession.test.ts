import { describe, expect, it } from "vitest";
import { initialImportSession, reduceImportSession, taskImportResumeOffset } from "./importSession";

describe("native task import session", () => {
  it("moves from file selection to review without retaining raw bytes", () => {
    const selected = reduceImportSession(initialImportSession, { type: "selected", fileLabel: "tasks.xlsx" });
    const parsed = reduceImportSession(selected, { type: "parsed", total: 12, unresolved: 0, issues: 0 });
    expect(parsed).toMatchObject({ stage: "review", fileLabel: "tasks.xlsx", total: 12, rawBytesHeld: false });
  });

  it("blocks review while explicit identity mappings remain unresolved", () => {
    const selected = reduceImportSession(initialImportSession, { type: "selected", fileLabel: "tasks.csv" });
    expect(reduceImportSession(selected, { type: "parsed", total: 4, unresolved: 1, issues: 0 })).toMatchObject({ stage: "map", unresolved: 1 });
  });

  it("tracks bounded chunk progress and completion", () => {
    let state = reduceImportSession({ ...initialImportSession, stage: "review", total: 205 }, { type: "run" });
    state = reduceImportSession(state, { type: "progress", processed: 100 });
    expect(state).toMatchObject({ stage: "run", processed: 100 });
    state = reduceImportSession(state, { type: "complete", message: "205 new records imported." });
    expect(state).toMatchObject({ stage: "result", processed: 205, result: "205 new records imported." });
  });

  it("retains resume coordinates after an interrupted chunk", () => {
    const running = { ...initialImportSession, stage: "run" as const, fileLabel: "tasks.csv", total: 205, processed: 100, batchId: "batch-1" };
    expect(reduceImportSession(running, { type: "failed", message: "Connection lost" })).toMatchObject({
      stage: "review",
      batchId: "batch-1",
      processed: 100,
      error: "Connection lost",
    });
  });

  it("resets progress when a corrected import starts a different batch", () => {
    const completed = {
      ...initialImportSession,
      stage: "result" as const,
      total: 4,
      processed: 4,
      batchId: "old-batch",
    };

    expect(reduceImportSession(completed, {
      type: "progress",
      processed: 0,
      batchId: "corrected-batch",
    })).toMatchObject({
      processed: 0,
      batchId: "corrected-batch",
    });
  });

  it("keeps progress monotonic while resuming the same batch", () => {
    const interrupted = {
      ...initialImportSession,
      stage: "review" as const,
      total: 205,
      processed: 100,
      batchId: "batch-1",
    };

    expect(reduceImportSession(interrupted, {
      type: "progress",
      processed: 50,
      batchId: "batch-1",
    })).toMatchObject({
      processed: 100,
      batchId: "batch-1",
    });
  });

  it("resumes only the batch that owns the saved cursor", () => {
    const interrupted = {
      ...initialImportSession,
      processed: 100,
      batchId: "batch-1",
    };

    expect(taskImportResumeOffset(interrupted, "batch-1")).toBe(100);
    expect(taskImportResumeOffset(interrupted, "corrected-batch")).toBe(0);
  });

  it("describes idempotent replay without reporting new work", () => {
    const replayed = reduceImportSession({ ...initialImportSession, stage: "run", total: 3 }, {
      type: "complete",
      message: "This file was already imported. No duplicate tasks were created.",
    });
    expect(replayed.result).toContain("No duplicate tasks");
  });
});
