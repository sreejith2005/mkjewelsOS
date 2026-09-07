import { describe, expect, it } from "vitest";
import { fmsFormDeepLinkPath, parseFmsFormDeepLink } from "./deepLink";

describe("FMS form deep links", () => {
  it("round-trips the exact instance stage and pinned form", () => {
    const path = fmsFormDeepLinkPath({ formTemplateId: "form-7", instanceId: "instance-5", instanceStageId: "stage-3" });

    expect(path).toBe("/tasks/fms?instance=instance-5&stage=stage-3&form=form-7");
    expect(parseFmsFormDeepLink(path)).toEqual({ formTemplateId: "form-7", instanceId: "instance-5", instanceStageId: "stage-3" });
  });

  it("rejects a link that cannot identify both the stage and its pinned form", () => {
    expect(parseFmsFormDeepLink("/tasks/fms?instance=instance-5&stage=stage-3")).toBeNull();
  });
});
