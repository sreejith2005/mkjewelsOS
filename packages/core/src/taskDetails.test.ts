import { describe, expect, it } from "vitest";
import {
  formatIndiaDateTime,
  taskBuddyCoverageLabel,
  taskEvidenceLabel,
  taskFrequencyLabel,
  taskScheduleStateLabel,
  taskTypeLabel,
  taskVerificationLabel,
} from "./taskDetails";

describe("task detail labels", () => {
  it("names task types the way the web card does", () => {
    expect(taskTypeLabel("checklist")).toBe("Checklist");
    expect(taskTypeLabel("delegation")).toBe("Task");
    expect(taskTypeLabel("fms")).toBe("FMS stage");
    expect(taskTypeLabel(null)).toBe("Task");
  });

  it("reads a missing schedule as one-time and an unknown one as recurring", () => {
    expect(taskFrequencyLabel(null)).toBe("One Time");
    expect(taskFrequencyLabel("weekly")).toBe("Weekly");
    expect(taskFrequencyLabel("custom_rule")).toBe("Recurring");
  });

  it("describes verification state", () => {
    expect(taskVerificationLabel({ verification_required: false })).toBe("Not required");
    expect(taskVerificationLabel({ verification_required: true, verification_status: "verified" })).toBe("Verified");
    expect(taskVerificationLabel({ verification_required: true, verification_status: null })).toBe("Verification required");
  });

  it("never reports evidence as owed on a checklist", () => {
    expect(taskEvidenceLabel({ task_type: "checklist", requires_upload: true }, false)).toBe("Not required");
    expect(taskEvidenceLabel({ task_type: "delegation", requires_upload: true }, false)).toBe("Evidence required");
    expect(taskEvidenceLabel({ task_type: "delegation", requires_upload: true }, true)).toBe("Evidence required · Uploaded");
  });

  it("omits buddy coverage and schedule state when they do not apply", () => {
    expect(taskBuddyCoverageLabel(null)).toBeNull();
    expect(taskBuddyCoverageLabel(false)).toBe("Buddy coverage not allowed");
    expect(taskScheduleStateLabel({ task_template_id: null, is_active: true })).toBeNull();
    expect(taskScheduleStateLabel({ task_template_id: "t-1", is_active: false })).toBe("Schedule paused");
  });

  it("formats in India business time and rejects invalid input", () => {
    expect(formatIndiaDateTime(null)).toBeNull();
    expect(formatIndiaDateTime("not a date")).toBeNull();
    expect(formatIndiaDateTime("2026-09-09T04:30:00.000Z")).toContain("10:00");
  });
});
