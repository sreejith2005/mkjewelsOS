import { describe, expect, it } from "vitest";
import { runtimeDecisionOptions } from "./decisions";

describe("runtimeDecisionOptions", () => {
  it("offers exactly the options the workflow author configured", () => {
    expect(
      runtimeDecisionOptions({
        decisionMode: "yes_no",
        decisionOptions: [
          { key: "bought", label: "Bought jewellery" },
          { key: "not_bought", label: "Did not buy" },
          { key: "later", label: "Will decide later" },
        ],
      }),
    ).toEqual([
      { key: "bought", label: "Bought jewellery" },
      { key: "not_bought", label: "Did not buy" },
      { key: "later", label: "Will decide later" },
    ]);
  });

  it("keeps a legacy yes/no step working when no options were ever stored", () => {
    expect(runtimeDecisionOptions({ decisionMode: "yes_no" })).toEqual([
      { key: "yes", label: "Yes" },
      { key: "no", label: "No" },
    ]);
  });

  it("offers nothing on an ordinary step, so no decision is invented", () => {
    expect(runtimeDecisionOptions({ decisionMode: "normal" })).toEqual([]);
    expect(runtimeDecisionOptions({})).toEqual([]);
  });

  it("drops malformed options rather than rendering a nameless button", () => {
    expect(
      runtimeDecisionOptions({
        decisionOptions: [{ key: "ok", label: "Fine" }, { key: "", label: "No key" }, { key: "blank", label: "  " }, null],
      }),
    ).toEqual([{ key: "ok", label: "Fine" }]);
  });
});
