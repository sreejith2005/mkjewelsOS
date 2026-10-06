import { describe, expect, it } from "vitest";
import { resolveNativeWorkPath } from "./workPath";

describe("native work paths from notifications and shell links", () => {
  it("retains starter assignment identity instead of opening the FMS console", () => {
    expect(resolveNativeWorkPath("/tasks/fms?starter=assignment-1&form=form-1")).toEqual({ screen: "FormFill", params: { starterAssignmentId: "assignment-1", formTemplateId: "form-1" } });
    expect(resolveNativeWorkPath("/tasks/fms?starter=assignment-2&form=form-1")).toEqual({ screen: "FormFill", params: { starterAssignmentId: "assignment-2", formTemplateId: "form-1" } });
  });
  it("retains runtime stage and linked form identities", () => {
    expect(resolveNativeWorkPath("/tasks/fms?instance=run-1&stage=step-1&form=form-1")).toEqual({ screen: "FmsStageForm", params: { instanceId: "run-1", instanceStageId: "step-1", formTemplateId: "form-1" } });
    expect(resolveNativeWorkPath("/tasks/fms?instance=run-1&stage=step-1")).toEqual({ screen: "FmsStage", params: { instanceId: "run-1", instanceStageId: "step-1" } });
  });
  it("does not infer work from an incomplete or foreign link", () => {
    expect(resolveNativeWorkPath("/tasks/fms?form=form-1")).toBeNull();
    expect(resolveNativeWorkPath("https://foreign.example/tasks/fms?starter=a&form=f")).toBeNull();
    expect(resolveNativeWorkPath("//foreign.example/tasks/import")).toBeNull();
  });
  it("opens nested import and assignment-remediation workspaces", () => {
    expect(resolveNativeWorkPath("/tasks/import")).toEqual({ screen: "TaskImport", params: undefined });
    expect(resolveNativeWorkPath("/tasks/assigning-left")).toEqual({ screen: "AssigningLeft", params: undefined });
  });
});
