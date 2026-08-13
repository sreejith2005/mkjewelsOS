import { describe, expect, it, vi } from "vitest";
import { isFormFieldVisible } from "@jewelos/core";

vi.mock("@jewelos/api-client", () => ({ supabase: {} }));

import { toDefinition, type FormField, type FormTemplate } from "./api";

describe("toDefinition", () => {
  it("does not turn a NULL database condition into a conditional field", () => {
    const template = { name: "Walk-in", description: null, permissions: { roles: ["staff"] } } as unknown as FormTemplate;
    const field = {
      id: "field-1", field_key: "customer_name", field_name: "Customer name", field_type: "text", sort_order: 0,
      is_required: false, is_shown: true, is_editable: true, placeholder: null, helper_text: null,
      options: null, validation: {}, conditional_logic: null,
    } as FormField;

    const definition = toDefinition(template, [field]);

    expect(definition.fields[0]).not.toHaveProperty("condition");
    expect(isFormFieldVisible(definition.fields[0]!, {})).toBe(true);
  });
});
