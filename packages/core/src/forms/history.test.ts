import { describe, expect, it } from "vitest";
import { compareFormDefinitions } from "./history.ts";
import type { FormTemplateDefinition } from "./types.ts";
const base: FormTemplateDefinition = { name: "Enquiry", fields: [{ key: "name", label: "Name", type: "text", sortOrder: 0 }], sections: [{ key: "details", title: "Details" }] };
describe("definition checkpoints", () => {
  it("ignores database field identities and object property order", () => {
    expect(compareFormDefinitions(base, { ...base, fields: [{ sortOrder: 0, type: "text", label: "Name", key: "name", id: "fresh-id" }] })).toEqual([]);
  });
  it("describes name, roles, sections, fields, conditions and required changes", () => {
    const changes = compareFormDefinitions(base, { ...base, name: "New", permissions: { roles: ["staff"] }, sections: [{ key: "details", title: "Client", next: "__submit__" }], fields: [{ ...base.fields[0]!, label: "Client name", required: true }, { key: "budget", label: "Budget", type: "currency", sortOrder: 1, rule: { kind: "predicate", fieldKey: "name", operator: "not_empty" } }] });
    expect(changes.map(change => change.property)).toEqual(expect.arrayContaining(["name", "permissions", "title", "next", "label", "required", "field"]));
    expect(changes.find(change => change.fieldKey === "budget")?.kind).toBe("added");
  });
  it("identifies removals, ordering, options, validations and nested logic", () => {
    const next: FormTemplateDefinition = { name: "Enquiry", fields: [{ key: "status", label: "Status", type: "radio", sortOrder: 0, options: [{ value: "yes", label: "Yes" }] }] };
    expect(compareFormDefinitions(base, next).filter(change => change.kind === "removed")).toHaveLength(2);
    expect(compareFormDefinitions(next, { ...next, fields: [{ ...next.fields[0]!, options: [{ value: "yes", label: "Purchased" }], validation: { min: 1 }, rule: { kind: "any", rules: [{ kind: "predicate", fieldKey: "other", operator: "not_empty" }] } }] }).map(change => change.property)).toEqual(expect.arrayContaining(["options", "validation", "rule"]));
  });
});
