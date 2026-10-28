import { describe, expect, it } from "vitest";
import { convertFormFieldType, displayFormAnswer, formFieldAllowsOther, reconcileFormPreviewAnswers, validateCompleteForm, validateFormDefinition, validateFormField, type FormFieldDefinition } from "./index";

const options = [{ value: "walk_in", label: "Walk-in" }, { value: "referral", label: "Referral" }];
const choice = (type: FormFieldDefinition["type"], allowOther = true): FormFieldDefinition => ({
  key: "source", label: "Lead source", type, sortOrder: 0, options, ...(allowOther ? { validation: { allowOther: true } } : {}),
});

describe("Other answers on choice questions", () => {
  it("is offered only by choice questions that switch it on", () => {
    expect(formFieldAllowsOther(choice("select"))).toBe(true);
    expect(formFieldAllowsOther(choice("radio"))).toBe(true);
    expect(formFieldAllowsOther(choice("multiselect"))).toBe(true);
    expect(formFieldAllowsOther(choice("checkbox"))).toBe(true);
    expect(formFieldAllowsOther(choice("select", false))).toBe(false);
    expect(formFieldAllowsOther({ type: "checkbox", validation: { allowOther: true } })).toBe(false);
    expect(formFieldAllowsOther({ type: "text", validation: { allowOther: true } })).toBe(false);
  });

  it("accepts typed text for one-answer questions and still checks lists without Other", () => {
    expect(validateFormField(choice("select"), "Instagram ad", {})).toBeUndefined();
    expect(validateFormField(choice("radio"), "walk_in", {})).toBeUndefined();
    expect(validateFormField(choice("select", false), "Instagram ad", {})?.code).toBe("invalid_option");
    expect(validateFormField({ ...choice("select"), required: true }, "  ", {})?.code).toBe("required");
  });

  it("accepts typed entries in multi-answer questions within the length limit", () => {
    expect(validateFormField(choice("multiselect"), ["walk_in", "Nose pin"], {})).toBeUndefined();
    expect(validateFormField(choice("checkbox"), ["Nose pin"], {})).toBeUndefined();
    expect(validateFormField(choice("multiselect"), ["x".repeat(501)], {})?.code).toBe("invalid_other");
    expect(validateFormField(choice("multiselect", false), ["Nose pin"], {})?.code).toBe("invalid_option");
    expect(validateFormField(choice("multiselect"), ["Nose pin", "Nose pin"], {})?.code).toBe("invalid_shape");
  });

  it("shows the typed text as the answer", () => {
    expect(displayFormAnswer(choice("select"), "Instagram ad")).toBe("Instagram ad");
    expect(displayFormAnswer(choice("multiselect"), ["walk_in", "Nose pin"])).toBe("Walk-in, Nose pin");
  });

  it("is a valid definition only on choice questions and survives a switch between them", () => {
    expect(validateFormDefinition({ name: "Lead", fields: [choice("select")] })).toEqual([]);
    expect(validateFormDefinition({ name: "Lead", fields: [{ key: "notes", label: "Notes", type: "text", sortOrder: 0, validation: { allowOther: true } }] }))
      .toEqual([expect.objectContaining({ code: "invalid_validation" })]);
    expect(convertFormFieldType([choice("select")], 0, "radio").fields[0]?.validation).toEqual({ allowOther: true });
    expect(convertFormFieldType([choice("select")], 0, "text").fields[0]?.validation).toBeUndefined();
  });

  it("keeps a typed preview answer and submits a complete form", () => {
    const form = { name: "Lead", fields: [choice("select")] };
    expect(reconcileFormPreviewAnswers(form, { source: "Instagram ad" })).toEqual({ source: "Instagram ad" });
    expect(validateCompleteForm(form, { source: "Instagram ad" }).valid).toBe(true);
  });
});
