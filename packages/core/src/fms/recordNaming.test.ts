import { describe, expect, it } from "vitest";
import { automaticRecordNameField, eligibleRecordNameFields, normalizeRecordName } from "./recordNaming";
import type { FormFieldDefinition } from "../forms/types";

const field = (key: string, type: FormFieldDefinition["type"] = "text", extra: Partial<FormFieldDefinition> = {}): FormFieldDefinition => ({ key, label: key.replaceAll("_", " "), type, sortOrder: 0, ...extra });
describe("record naming", () => {
  it("offers only suitable visible scalar identifying questions", () => {
    const fields = [field("customer_name"), field("order_number", "number"), field("notes", "textarea"), field("attachment", "file"), field("password"), field("hidden", "text", { shown: false })];
    expect(eligibleRecordNameFields(fields).map(f => f.key)).toEqual(["customer_name", "order_number"]);
  });
  it("chooses a deterministic identifier rather than arbitrary private text", () => {
    expect(automaticRecordNameField([field("remarks"), field("client_name", "text", { sortOrder: 2 }), field("lead_name")])?.key).toBe("client_name");
    expect(automaticRecordNameField([field("private_notes"), field("email", "email")])).toBeUndefined();
    expect(automaticRecordNameField([field("order_number", "number")])?.key).toBe("order_number");
  });
  it("bounds names without exposing raw identifiers or placeholders", () => {
    expect(normalizeRecordName("  Rahul\n  Shah  ")).toBe("Rahul Shah");
    expect(normalizeRecordName("00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(normalizeRecordName("{initial.name}")).toBeNull();
    expect(normalizeRecordName("null")).toBeNull();
    expect(normalizeRecordName("x".repeat(500))?.length).toBe(120);
  });
});
