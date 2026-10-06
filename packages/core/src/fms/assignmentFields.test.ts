import { describe, expect, it } from "vitest";
import { fmsAssignmentFields } from "./engine";
import type { FmsFormFieldRef } from "./types";

describe("FMS form assignment questions", () => {
  it("offers only required, always visible Users-backed questions", () => {
    const fields: FmsFormFieldRef[] = [
      { key: "doer", label: "Doer", type: "user_dropdown", required: true },
      { key: "optional", label: "Optional", type: "user_dropdown" },
      { key: "hidden", label: "Hidden", type: "user_dropdown", required: true, shown: false },
      { key: "conditional", label: "Conditional", type: "user_dropdown", required: true, hasCondition: true },
      { key: "text", label: "Text", type: "text", required: true },
    ];
    expect(fmsAssignmentFields(fields).map((field) => field.key)).toEqual(["doer"]);
    expect(fmsAssignmentFields([])).toEqual([]);
  });
});
