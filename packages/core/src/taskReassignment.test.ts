import { describe, expect, it } from "vitest";
import { batchReassignPlan, parseReassignCandidates, parseReassignResult, planReassignAll, planReassignSelected, reassignPlanSize, type ReassignCandidates } from "./taskReassignment";

const candidates: ReassignCandidates = {
  tasks: [
    { id: "t-old", title: "Missed follow-up", task_template_id: null, due_at: "2026-10-01T10:00:00Z", overdue: true },
    { id: "t-next", title: "Call client", task_template_id: null, due_at: "2026-11-05T10:00:00Z", overdue: false },
    { id: "t-daily-1", title: "Daily stock check", task_template_id: "daily", due_at: "2026-11-03T10:00:00Z", overdue: false },
    { id: "t-daily-2", title: "Daily stock check", task_template_id: "daily", due_at: "2026-11-04T10:00:00Z", overdue: false },
    { id: "t-other-series", title: "Weekly report", task_template_id: "not-theirs", due_at: null, overdue: false },
  ],
  fms_steps: [{ id: "s-1", title: "Follow-up · Lead 12" }],
  schedules: [{ id: "daily", title: "Daily stock check" }],
};

describe("reassign all open work", () => {
  it("takes every group that is ticked", () => {
    const plan = planReassignAll(candidates, { upcoming: true, overdue: true, fmsSteps: true, schedules: true });
    expect(plan.taskIds).toEqual(["t-old", "t-next", "t-daily-1", "t-daily-2", "t-other-series"]);
    expect(plan.fmsStageIds).toEqual(["s-1"]);
    expect(plan.templateIds).toEqual(["daily"]);
    expect(reassignPlanSize(plan)).toBe(7);
  });

  it("leaves overdue tasks, FMS steps and schedules behind when unticked", () => {
    const plan = planReassignAll(candidates, { upcoming: true, overdue: false, fmsSteps: false, schedules: false });
    expect(plan).toEqual({ taskIds: ["t-next", "t-daily-1", "t-daily-2", "t-other-series"], fmsStageIds: [], templateIds: [] });
  });
});

describe("reassign selected work", () => {
  it("moves only the ticked rows when schedules are not included", () => {
    expect(planReassignSelected(candidates, ["t-next", "s-1", "t-daily-1"], false)).toEqual({ taskIds: ["t-next", "t-daily-1"], fmsStageIds: ["s-1"], templateIds: [] });
  });

  it("moves the person's schedule and its other open tasks with a selected recurring task", () => {
    const plan = planReassignSelected(candidates, ["t-daily-1"], true);
    expect(plan.templateIds).toEqual(["daily"]);
    expect(plan.taskIds).toEqual(["t-daily-1", "t-daily-2"]);
  });

  it("leaves out rows that are not the person's open work", () => {
    expect(planReassignSelected(candidates, ["t-next", "finished-task", "someone-elses"], false).taskIds).toEqual(["t-next"]);
  });

  it("never moves a schedule that belongs to someone else", () => {
    expect(planReassignSelected(candidates, ["t-other-series"], true).templateIds).toEqual([]);
  });
});

describe("batching", () => {
  it("splits large plans into calls of at most 100 items", () => {
    const plan = { taskIds: Array.from({ length: 230 }, (_, i) => `t${i}`), fmsStageIds: ["s"], templateIds: ["d"] };
    const batches = batchReassignPlan(plan);
    expect(batches.map(reassignPlanSize)).toEqual([100, 100, 32]);
    expect(batches[2]).toEqual({ taskIds: Array.from({ length: 30 }, (_, i) => `t${i + 200}`), fmsStageIds: ["s"], templateIds: ["d"] });
  });
});

describe("server responses", () => {
  it("reads candidates and results defensively", () => {
    expect(parseReassignCandidates({ tasks: [{ id: "a", title: "", overdue: true }], fms_steps: [{}], schedules: null }))
      .toEqual({ tasks: [{ id: "a", title: "Untitled task", task_template_id: null, due_at: null, overdue: true }], fms_steps: [], schedules: [] });
    expect(parseReassignResult({ moved: ["a", 3], skipped: [{ id: "b", reason: "This task is already completed" }] }))
      .toEqual({ moved: ["a"], skipped: [{ id: "b", reason: "This task is already completed" }] });
    expect(() => parseReassignResult(null)).toThrow();
  });
});
