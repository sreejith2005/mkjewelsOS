import { describe, expect, it } from "vitest";
import { evaluateFmsBranchRule } from "./engine";
import { fmsRouteAnswerSelection } from "./routeAnswers";

describe("route answer selection", () => {
  it("preserves a single-answer equals route", () => {
    expect(fmsRouteAnswerSelection("equals", ["a"])).toEqual({ operator: "equals", value: "a" });
  });
  it("matches any selected answer using the existing in contract", () => {
    const patch = fmsRouteAnswerSelection("equals", ["a", "b", "a"]);
    expect(patch).toEqual({ operator: "in", value: ["a", "b"] });
    const rule = { id: "r", source: "form_answer" as const, sourceKey: "status", order: 0, ...patch };
    expect(evaluateFmsBranchRule(rule, "a")).toBe(true);
    expect(evaluateFmsBranchRule(rule, "b")).toBe(true);
    expect(evaluateFmsBranchRule(rule, "c")).toBe(false);
    expect(evaluateFmsBranchRule(rule, ["c", "b"])).toBe(true);
  });
  it("retains in after deselection and allows an empty selection for validation", () => {
    expect(fmsRouteAnswerSelection("in", ["b"])).toEqual({ operator: "in", value: ["b"] });
    expect(fmsRouteAnswerSelection("in", [])).toEqual({ operator: "in", value: [] });
  });
});
