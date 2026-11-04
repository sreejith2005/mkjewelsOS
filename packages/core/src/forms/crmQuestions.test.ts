// CRM question types (owner request 2026-11-03): repeating groups, CRM photo uploads, CRM lookups
// and branch choice lists, as the Form Builder saves them and the form checks them.
import { describe, expect, it } from "vitest";
import { displayFormAnswer } from "./answerDisplay";
import { normalizeFormAnswer } from "./answers";
import { validateFormDefinition } from "./definition";
import { resolveFormOptions } from "./options";
import { validateCompleteForm, validateFormField } from "./validation";
import { isEmptyFormValue } from "./visibility";
import type { FormFieldDefinition, FormRepeatAnswer, FormTemplateDefinition } from "./types";

const companions: FormFieldDefinition = {
  key: "companions", label: "Family / friends", type: "repeat", sortOrder: 0,
  validation: { repeat: { countLabel: "How many family members / friends are with them?", min: 0, max: 10, fields: [
    { key: "name", label: "Name", type: "text", required: true },
    { key: "mobile", label: "Mobile", type: "phone" },
    { key: "relation", label: "Relation", type: "select", optionSource: { kind: "master", masterType: "client_relation" } },
  ] } },
};
const proof: FormFieldDefinition = { key: "proof", label: "Google review proof", type: "crm_photo", sortOrder: 1, required: true, validation: { crm: { maxFiles: 1 } } };
const form = (...fields: FormFieldDefinition[]): FormTemplateDefinition => ({ name: "Walk-in", fields: fields.map((field, sortOrder) => ({ ...field, sortOrder })) });
const rows = (count: string, ...items: Array<Record<string, string>>): FormRepeatAnswer => ({ kind: "repeat", count, rows: items });

describe("repeating groups", () => {
  it("is a valid question with its row questions", () => {
    expect(validateFormDefinition(form(companions))).toEqual([]);
  });

  it("explains a repeating group without row questions or with a bad range", () => {
    expect(validateFormDefinition(form({ ...companions, validation: {} })).map((issue) => issue.message)).toEqual(["Family / friends: add the questions asked for each row"]);
    expect(validateFormDefinition(form({ ...companions, validation: { repeat: { ...companions.validation!.repeat!, min: 5, max: 2 } } }))[0]!.message).toContain("between 0 and 20");
    expect(validateFormDefinition(form({ ...companions, validation: { repeat: { ...companions.validation!.repeat!, fields: [{ key: "r", label: "Relation", type: "select" }] } } }))[0]!.message).toContain("needs its choices");
  });

  it("checks each row: required row answers, phone numbers and choices", () => {
    const resolved = resolveFormOptions(form(companions), [{ masterType: "client_relation", value: "wife", label: "Wife" }]);
    const field = resolved.fields[0]!;
    expect(field.validation?.repeat?.fields[2]!.options).toEqual([{ value: "wife", label: "Wife" }]);
    expect(validateFormField(field, rows("2", { name: "Asha", relation: "wife" }, { name: "" }), {})?.message).toBe("Family / friends 2: Name is required");
    expect(validateFormField(field, rows("1", { name: "Asha", mobile: "12" }), {})?.code).toBe("invalid_phone");
    expect(validateFormField(field, rows("1", { name: "Asha", relation: "boss" }), {})?.code).toBe("invalid_option");
    expect(validateFormField(field, rows("11"), {})?.message).toContain("choose 0 to 10");
    expect(validateFormField(field, rows("0"), {})).toBeUndefined();
    expect(validateFormField(field, rows("1", { name: "Asha", mobile: "+91 98765 43210", relation: "wife" }), {})).toBeUndefined();
  });

  it("offers NA only when allowed", () => {
    const tags: FormFieldDefinition = { key: "seen", label: "Products seen", type: "repeat", sortOrder: 0, validation: { repeat: { countLabel: "Number of products seen", min: 1, max: 10, allowNa: true, fields: [{ key: "tag", label: "Tag / code", type: "text" }] } } };
    expect(validateFormField(tags, rows("NA"), {})).toBeUndefined();
    expect(validateFormField({ ...tags, validation: { repeat: { ...tags.validation!.repeat!, allowNa: false } } }, rows("NA"), {})?.code).toBe("invalid_shape");
  });

  it("keeps only the rows asked for, trimmed, and reads back as text", () => {
    expect(normalizeFormAnswer(companions, rows("1", { name: " Asha " }, { name: "Extra" }))).toEqual(rows("1", { name: "Asha" }));
    const resolved = resolveFormOptions(form(companions), [{ masterType: "client_relation", value: "wife", label: "Wife" }]).fields[0]!;
    expect(displayFormAnswer(resolved, rows("2", { name: "Asha", relation: "wife" }, { name: "Ravi", mobile: "9876543210" }))).toBe("1. Name: Asha, Relation: Wife; 2. Name: Ravi, Mobile: 9876543210");
    expect(isEmptyFormValue(rows(""))).toBe(true);
    expect(isEmptyFormValue(rows("0"))).toBe(false);
  });

  it("cannot be read by a condition", () => {
    const shown: FormFieldDefinition = { key: "note", label: "Note", type: "text", sortOrder: 1, rule: { kind: "predicate", fieldKey: "companions", operator: "not_empty" } };
    expect(validateFormDefinition(form(companions, shown)).map((issue) => issue.code)).toContain("unavailable_rule_source");
  });
});

describe("CRM photo and video questions", () => {
  it("requires an upload when required and limits the number of files", () => {
    expect(validateFormDefinition(form(proof))).toEqual([]);
    expect(validateFormField(proof, undefined, {})?.code).toBe("required");
    const file = { path: "c/t/x_a.jpg", clientId: "c", fileName: "a.jpg", mimeType: "image/jpeg" };
    expect(validateFormField(proof, { kind: "crm_files", files: [file] }, {})).toBeUndefined();
    expect(validateFormField(proof, { kind: "crm_files", files: [file, file] }, {})?.message).toBe("Google review proof: add up to 1 file");
    expect(displayFormAnswer(proof, { kind: "crm_files", files: [file] })).toBe("a.jpg");
    expect(validateCompleteForm(form({ ...proof, required: false }), {}).valid).toBe(true);
  });
});

describe("CRM behaviours", () => {
  it("accept each setting only on the question type it suits", () => {
    const phone: FormFieldDefinition = { key: "mobile", label: "Mobile", type: "phone", sortOrder: 0, validation: { crm: { lookup: "client_phone" } } };
    const pincode: FormFieldDefinition = { key: "pincode", label: "Pincode", type: "text", sortOrder: 1, validation: { crm: { lookup: "pincode" } } };
    const salesperson: FormFieldDefinition = { key: "sp", label: "Salesperson", type: "text", sortOrder: 2, validation: { crm: { choices: "salespeople" } } };
    expect(validateFormDefinition(form(phone, pincode, salesperson, proof))).toEqual([]);
    expect(validateFormDefinition(form({ ...salesperson, type: "date" }))[0]!.message).toContain("short text");
    expect(validateFormDefinition(form({ ...phone, validation: { crm: { maxFiles: 3 } } }))[0]!.message).toContain("CRM photo question");
    expect(validateFormDefinition(form({ ...proof, validation: { crm: { maxFiles: 11 } } }))[0]!.message).toContain("1 to 10 files");
  });
});
