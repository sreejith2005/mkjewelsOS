import { describe, expect, it } from "vitest";
import { fmsAssignedWorkRoute, fmsAssignedWorkRouteForTask } from "./assignedWorkNavigation";

describe("fmsAssignedWorkRoute", () => {
  it("sends starter work to the focused form fill screen", () => {
    expect(fmsAssignedWorkRoute({
      kind: "starter_form",
      starterAssignmentId: "starter-2",
      formTemplateId: "form-7",
    })).toEqual({
      screen: "FormFill",
      params: { formTemplateId: "form-7", starterAssignmentId: "starter-2" },
    });
  });

  it("sends runtime form work to the exact instance stage form", () => {
    expect(fmsAssignedWorkRoute({
      kind: "stage_form",
      instanceId: "instance-5",
      instanceStageId: "stage-3",
      formTemplateId: "form-7",
    })).toEqual({
      screen: "FmsStageForm",
      params: { instanceId: "instance-5", instanceStageId: "stage-3", formTemplateId: "form-7" },
    });
  });

  it("sends form-less runtime work to the instance workspace", () => {
    expect(fmsAssignedWorkRoute({ kind: "stage", instanceId: "instance-5", instanceStageId: null }))
      .toEqual({ screen: "FmsInstance", params: { instanceId: "instance-5" } });
  });

  it("opens the exact stage when the runtime stage is known", () => {
    expect(fmsAssignedWorkRoute({ kind: "stage", instanceId: "instance-5", instanceStageId: "stage-3" }))
      .toEqual({ screen: "FmsStage", params: { instanceId: "instance-5", instanceStageId: "stage-3" } });
  });
});

describe("fmsAssignedWorkRouteForTask", () => {
  it("resolves a starter task row by its assignment identity", () => {
    expect(fmsAssignedWorkRouteForTask({
      task_type: "fms",
      form_template_id: "form-7",
      fms_work_source: "fms_starter",
      fms_instance_id: null,
      fms_instance_stage_id: null,
      fms_starter_assignment_id: "starter-2",
    })).toEqual({
      screen: "FormFill",
      params: { formTemplateId: "form-7", starterAssignmentId: "starter-2" },
    });
  });

  it("resolves a runtime stage task row with a pinned form", () => {
    expect(fmsAssignedWorkRouteForTask({
      task_type: "fms",
      form_template_id: "form-7",
      fms_work_source: "fms_stage",
      fms_instance_id: "instance-5",
      fms_instance_stage_id: "stage-3",
      fms_starter_assignment_id: null,
    })).toEqual({
      screen: "FmsStageForm",
      params: { instanceId: "instance-5", instanceStageId: "stage-3", formTemplateId: "form-7" },
    });
  });

  it("resolves a runtime stage task row without a pinned form", () => {
    expect(fmsAssignedWorkRouteForTask({
      task_type: "fms",
      form_template_id: null,
      fms_work_source: "fms_stage",
      fms_instance_id: "instance-5",
      fms_instance_stage_id: "stage-3",
      fms_starter_assignment_id: null,
    })).toEqual({
      screen: "FmsStage", params: { instanceId: "instance-5", instanceStageId: "stage-3" },
    });
  });

  it("leaves an ordinary required-form task to the ordinary task form route", () => {
    expect(fmsAssignedWorkRouteForTask({
      task_type: "checklist",
      form_template_id: "form-7",
      fms_work_source: null,
      fms_instance_id: null,
      fms_instance_stage_id: null,
      fms_starter_assignment_id: null,
    })).toBeNull();
  });

  it("refuses an FMS row that carries no usable work identity", () => {
    expect(fmsAssignedWorkRouteForTask({
      task_type: "fms",
      form_template_id: "form-7",
      fms_work_source: "fms_starter",
      fms_instance_id: null,
      fms_instance_stage_id: null,
      fms_starter_assignment_id: null,
    })).toBeNull();
  });
});
