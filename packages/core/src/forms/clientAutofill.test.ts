import { describe, expect, it } from "vitest";
import { clientDetailsForForm, clientProfileKeyFor, isClientPhoneQuestion, isPincodeQuestion } from "./clientAutofill";
import type { FormFieldDefinition } from "./types";

const q = (key: string, label: string, type: FormFieldDefinition["type"] = "text", sortOrder = 0): FormFieldDefinition => ({ key, label, type, sortOrder });

describe("automatic client details in any form", () => {
  it("recognises client details by key or by everyday wording", () => {
    expect(clientProfileKeyFor(q("q1", "Client name"))).toBe("primary_name");
    expect(clientProfileKeyFor(q("q2", "Customer Name"))).toBe("primary_name");
    expect(clientProfileKeyFor(q("dob", "When were they born?", "date"))).toBe("dob");
    expect(clientProfileKeyFor(q("q3", "Date of birth", "date"))).toBe("dob");
    expect(clientProfileKeyFor(q("q4", "PIN code"))).toBe("pincode");
    expect(clientProfileKeyFor(q("q5", "Community / Caste", "select"))).toBe("community");
    expect(clientProfileKeyFor(q("q6", "What did they like?"))).toBeNull();
    expect(clientProfileKeyFor(q("q7", "Name", "section_header"))).toBeNull();
  });

  it("knows which questions hold the client's phone number and pincode", () => {
    expect(isClientPhoneQuestion(q("any", "Their number", "phone"))).toBe(true);
    expect(isClientPhoneQuestion(q("billing", "Billing phone", "phone"))).toBe(false);
    expect(isClientPhoneQuestion(q("ref", "Reference phone", "phone"))).toBe(false);
    expect(isClientPhoneQuestion(q("m", "Mobile number"))).toBe(true);
    expect(isClientPhoneQuestion(q("m", "Remarks"))).toBe(false);
    expect(isPincodeQuestion(q("p", "Pincode"))).toBe(true);
  });

  it("fills each detail into the first question asking for it, leaving the phone and unknown questions alone", () => {
    const fields = [q("mobile", "Mobile", "phone", 0), q("name", "Client name", "text", 1), q("again", "Name", "text", 2), q("city", "City", "text", 3), q("note", "Notes", "text", 4)];
    expect(clientDetailsForForm(fields, { primary_name: "Asha", city: "Kochi", gender: "FEMALE", state: "" })).toEqual({ name: "Asha", city: "Kochi" });
  });
});
