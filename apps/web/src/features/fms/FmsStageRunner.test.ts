import { describe, expect, it } from "vitest";
import { runtimeDecisionOptions } from "./FmsStageRunner";

describe("runtimeDecisionOptions", () => {
  it("uses configured decision options instead of a fixed Yes/No list", () => {
    expect(runtimeDecisionOptions({ decisionMode: "yes_no", decisionOptions: [{ key: "connected", label: "Call Connected" }, { key: "callback", label: "Call Back Required" }] })).toEqual([
      { key: "connected", label: "Call Connected" },
      { key: "callback", label: "Call Back Required" },
    ]);
  });

  it("keeps existing Yes/No decisions executable when their stored options are absent", () => {
    expect(runtimeDecisionOptions({ decisionMode: "yes_no" })).toEqual([{ key: "yes", label: "Yes" }, { key: "no", label: "No" }]);
  });
});
