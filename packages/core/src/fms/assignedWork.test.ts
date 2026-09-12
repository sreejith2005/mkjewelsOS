import { describe, expect, it } from "vitest";
import { fmsAssignedWorkPath, parseFmsAssignedWorkPath } from "./assignedWork";

describe("FMS assigned-work destinations", () => {
  it("round-trips an exact starter assignment and pinned form", () => {
    const target = {
      kind: "starter_form" as const,
      starterAssignmentId: "starter 2",
      formTemplateId: "form/7",
    };

    const path = fmsAssignedWorkPath(target);

    expect(path).toBe("/tasks/fms?starter=starter+2&form=form%2F7");
    expect(parseFmsAssignedWorkPath(path)).toEqual(target);
  });

  it("round-trips an exact runtime stage and pinned form", () => {
    const target = {
      kind: "stage_form" as const,
      instanceId: "instance-5",
      instanceStageId: "stage-3",
      formTemplateId: "form-7",
    };

    const path = fmsAssignedWorkPath(target);

    expect(path).toBe("/tasks/fms?instance=instance-5&stage=stage-3&form=form-7");
    expect(parseFmsAssignedWorkPath(path)).toEqual(target);
  });

  it("preserves the legacy instance-only stage destination", () => {
    expect(parseFmsAssignedWorkPath("/tasks/fms?instance=instance-5")).toEqual({
      kind: "stage",
      instanceId: "instance-5",
      instanceStageId: null,
    });
  });

  it("accepts an exact runtime stage without a form", () => {
    expect(parseFmsAssignedWorkPath("/tasks/fms?instance=instance-5&stage=stage-3")).toEqual({
      kind: "stage",
      instanceId: "instance-5",
      instanceStageId: "stage-3",
    });
  });

  it("rejects partial, conflicting, and unrelated destinations", () => {
    expect(parseFmsAssignedWorkPath("/tasks/fms?starter=starter-2")).toBeNull();
    expect(parseFmsAssignedWorkPath("/tasks/fms?form=form-7")).toBeNull();
    expect(parseFmsAssignedWorkPath("/tasks/fms?starter=starter-2&form=form-7&instance=instance-5")).toBeNull();
    expect(parseFmsAssignedWorkPath("/forms?starter=starter-2&form=form-7")).toBeNull();
  });
});
