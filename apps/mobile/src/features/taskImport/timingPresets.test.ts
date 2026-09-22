import { describe, expect, it } from "vitest";
import {
  initialTaskImportTimingPresets,
  taskImportTimingWindowsValid,
  updateTaskImportTimingPreset,
} from "./timingPresets";

describe("native task import timing presets", () => {
  it("creates independent store-hour timing defaults", () => {
    const first = initialTaskImportTimingPresets();
    const second = initialTaskImportTimingPresets();

    expect(first).toEqual({
      general: { startTime: "11:00", dueTime: "13:00" },
      opening: { startTime: "11:00", dueTime: "13:00" },
      morning: { startTime: "11:00", dueTime: "13:00" },
      closing: { startTime: "18:00", dueTime: "20:00" },
      evening: { startTime: "18:00", dueTime: "20:00" },
      manual: { startTime: "11:00", dueTime: "20:00" },
    });
    expect(first.opening).not.toBe(second.opening);
    expect(first.manual).not.toBe(second.manual);
  });

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
