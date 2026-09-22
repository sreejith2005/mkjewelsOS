import { describe, expect, it } from "vitest";
import { taskImportTimingWindowsValid, updateTaskImportTimingPreset } from "./timingPresets";

describe("native task import timing presets", () => {
  it("updates one required time without discarding another preset", () => {
    const first = updateTaskImportTimingPreset({}, "opening", "startTime", "09:00");
    const second = updateTaskImportTimingPreset(first, "closing", "dueTime", "20:00");
    expect(second).toEqual({
      opening: { startTime: "09:00", dueTime: "" },
      closing: { startTime: "", dueTime: "20:00" },
    });
  });

  it("requires a later due time for every requested preset", () => {
    expect(taskImportTimingWindowsValid(["general"], {
      general: { startTime: "18:00", dueTime: "09:00" },
    })).toBe(false);
    expect(taskImportTimingWindowsValid(["general"], {
      general: { startTime: "09:00", dueTime: "18:00" },
    })).toBe(true);
  });
});
