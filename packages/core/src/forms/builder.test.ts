import { describe, expect, it } from "vitest";
import {
  addFormSection,
  createFormField,
  duplicateFormField,
  moveFormField,
  removeFormField,
  removeFormSection,
  updateFormField,
  type FormTemplateDefinition,
} from "./index";

const definition = (): FormTemplateDefinition => ({
  name: "Phone builder",
  sections: [{ key: "section_1", title: "First" }, { key: "section_2", title: "Second" }],
  fields: [
    { key: "field_1", label: "Choice", type: "select", sortOrder: 0, sectionKey: "section_1", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
    { key: "field_2", label: "Details", type: "text", sortOrder: 1, sectionKey: "section_1", rule: { kind: "predicate", fieldKey: "field_1", operator: "equals", value: "yes" } },
    { key: "field_3", label: "Final", type: "text", sortOrder: 2, sectionKey: "section_2" },
  ],
});

describe("form builder mutations", () => {
  it("creates stable fields without mutating the source", () => {
    const source = definition().fields;
    const created = createFormField("checkbox", source, "section_1");
    expect(created).toMatchObject({ key: "field_4", type: "checkbox", sectionKey: "section_1", required: false });
    expect(created.options).toEqual([{ value: "option_1", label: "Option 1" }]);
    expect(source).toHaveLength(3);
  });

  it("moves only inside a section and renumbers fields", () => {
    const source = definition();
    const moved = moveFormField(source, "field_2", -1);
    expect(moved.fields.map((field) => field.key)).toEqual(["field_2", "field_1", "field_3"]);
    expect(moved.fields.map((field) => field.sortOrder)).toEqual([0, 1, 2]);
    expect(moveFormField(source, "field_2", 1)).toBe(source);
  });

  it("renames rule references and clears removed option paths", () => {
    const source = definition();
    const renamed = updateFormField(source, "field_1", { key: "customer_type" });
    expect(renamed.fields[1]?.rule).toMatchObject({ fieldKey: "customer_type" });
    const optionsRemoved = updateFormField(renamed, "customer_type", { options: [{ value: "no", label: "No" }] });
    expect(optionsRemoved.fields[1]?.rule).toBeUndefined();
  });

  it("duplicates and removes fields without dangling references", () => {
    const source = definition();
    const duplicated = duplicateFormField(source, "field_1");
    expect(duplicated.fields[1]).toMatchObject({ key: "field_4", label: "Choice copy" });
    const removed = removeFormField(source, "field_1");
    expect(removed.fields.map((field) => field.key)).toEqual(["field_2", "field_3"]);
    expect(removed.fields[0]?.rule).toBeUndefined();
  });

  it("adds unique sections and removes their fields and routes", () => {
    const source: FormTemplateDefinition = {
      ...definition(),
      sections: [{ key: "section_1", title: "First", next: "section_2" }, { key: "section_2", title: "Second" }],
      fields: definition().fields.map((field) => field.key === "field_1" ? { ...field, branches: [{ operator: "equals", value: "yes", targetSectionKey: "section_2" }] } : field),
    };
    const added = addFormSection(source);
    expect(added.sections?.at(-1)).toEqual({ key: "section_3", title: "Section 3" });
    const removed = removeFormSection(source, "section_2");
    expect(removed.sections).toEqual([{ key: "section_1", title: "First" }]);
    expect(removed.fields.map((field) => field.key)).toEqual(["field_1", "field_2"]);
    expect(removed.fields[0]?.branches).toBeUndefined();
  });
});
