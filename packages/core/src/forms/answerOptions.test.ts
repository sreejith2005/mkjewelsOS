import { describe, expect, it } from "vitest";
import { formAnswerOptions, type FormChoiceSources } from "./options";
import type { FormFieldDefinition } from "./types";

const sources: FormChoiceSources = { users: [{ id: "assigned-user", label: "Assigned user" }], branches: [], departments: [],
  masters: [{ masterType: "metal", value: "gold", label: "Gold" }, { masterType: "other", value: "silver", label: "Silver" }] };
const field: FormFieldDefinition = { key: "field", label: "Field", type: "select", sortOrder: 0 };
describe("authoring answer choices", () => {
  it("uses the referenced master rather than stale inline choices", () => {
    expect(formAnswerOptions({ ...field, optionSource: { kind: "master", masterType: "metal" }, options: [{ value: "stale", label: "Stale" }] }, sources)).toEqual([{ value: "gold", label: "Gold" }]);
  });
  it("offers roster identities and keeps free text out of answer mapping", () => {
    expect(formAnswerOptions({ ...field, type: "user_dropdown" }, sources)).toEqual([{ value: "assigned-user", label: "Assigned user" }]);
    expect(formAnswerOptions({ ...field, type: "text" }, sources)).toBeNull();
  });
});
