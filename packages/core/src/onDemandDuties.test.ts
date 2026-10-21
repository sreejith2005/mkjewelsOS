import { describe, expect, it } from "vitest";
import {
  isOnDemandSchedule,
  onDemandDutyProgress,
  onDemandTriggerLabel,
  parseOnDemandDuties,
} from "./onDemandDuties";

describe("on-demand duties", () => {
  it("parses the database answer and labels a missing trigger", () => {
    const duties = parseOnDemandDuties({
      duties: [
        { template_id: "t1", title: "Offer water", trigger_label: "Per Customer", task_type: "checklist", priority: "high",
          due_time: "20:00:00", requires_upload: false, started_today: 3, completed_today: 2, open_count: 1,
          open_task_id: "task-1", description: null },
        { template_id: "t2", title: "Visit report", trigger_label: null, task_type: "delegation", started_today: "0" },
        { template_id: "", title: "Dropped" },
        "not a row",
      ],
    });
    expect(duties).toEqual([
      { templateId: "t1", title: "Offer water", description: null, triggerLabel: "Per Customer", taskType: "checklist",
        priority: "high", dueTime: "20:00:00", requiresUpload: false, startedToday: 3, completedToday: 2, openCount: 1,
        openTaskId: "task-1" },
      { templateId: "t2", title: "Visit report", description: null, triggerLabel: "As needed", taskType: "delegation",
        priority: "medium", dueTime: null, requiresUpload: false, startedToday: 0, completedToday: 0, openCount: 0,
        openTaskId: null },
    ]);
  });

  it("rejects a response without a duty list", () => {
    expect(() => parseOnDemandDuties(null)).toThrow("On-demand duties response is invalid");
    expect(() => parseOnDemandDuties({ duties: "x" })).toThrow("On-demand duties response is invalid");
  });

  it("describes today's progress", () => {
    expect(onDemandDutyProgress({ completedToday: 0, openCount: 0 })).toBe("Not done today");
    expect(onDemandDutyProgress({ completedToday: 2, openCount: 0 })).toBe("Done 2 today");
    expect(onDemandDutyProgress({ completedToday: 2, openCount: 1 })).toBe("Done 2 today · 1 open");
    expect(onDemandDutyProgress({ completedToday: 0, openCount: 1 })).toBe("1 open");
  });

  it("recognises event-driven schedules only", () => {
    expect(isOnDemandSchedule({ schedule_kind: "as_required" })).toBe(true);
    expect(isOnDemandSchedule({ schedule_kind: "daily" })).toBe(false);
    expect(onDemandTriggerLabel("  ")).toBe("As needed");
  });
});
