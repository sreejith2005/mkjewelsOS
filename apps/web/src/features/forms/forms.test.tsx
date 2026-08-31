// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORM_SUBMIT_TARGET, type FormOption, type FormTemplateDefinition } from "@jewelos/core";
import { FormBuilder, nextFormFieldKey } from "./FormBuilder";
import type { FormBundle } from "./api";
import { FormRenderer, type DynamicOptions } from "./FormRenderer";
import { OptionListEditor } from "./OptionListEditor";

vi.mock("@/features/dropdowns/api", () => ({
  loadMasterOptions: vi.fn(async () => []),
  toFormMasterOptions: vi.fn(() => []),
}));

afterEach(cleanup);

const options: DynamicOptions = {
  users: [], branches: [], departments: [],
  masters: [
    { masterType: "customer_type", value: "individual", label: "Individual" },
    { masterType: "customer_type", value: "business", label: "Business" },
  ],
};

// The Customer Onboarding acceptance form, referencing Dropdown Master.
const onboarding: FormTemplateDefinition = {
  name: "Customer Onboarding",
  sections: [
    { key: "section_1", title: "Customer type" },
    { key: "individual_details", title: "Individual Details", next: FORM_SUBMIT_TARGET },
    { key: "business_details", title: "Business Details" },
  ],
  fields: [
    { key: "customer_type", label: "Customer type", type: "select", sortOrder: 0, sectionKey: "section_1", required: true,
      optionSource: { kind: "master", masterType: "customer_type" },
      branches: [
        { operator: "equals", value: "individual", targetSectionKey: "individual_details" },
        { operator: "equals", value: "business", targetSectionKey: "business_details" },
      ] },
    { key: "individual_name", label: "Name", type: "text", sortOrder: 1, sectionKey: "individual_details", required: true },
    { key: "company_name", label: "Company Name", type: "text", sortOrder: 2, sectionKey: "business_details", required: true },
    { key: "gst_number", label: "GST Number", type: "text", sortOrder: 3, sectionKey: "business_details", required: true },
  ],
};

const conditionalBundle = {
  id: "form-1", name: "Metal details", description: null, lifecycle: "draft", permissions: { roles: ["staff"] },
  sections: [{ key: "section_1", title: "Section 1" }], submissionCount: 0,
  fields: [
    { key: "metal", label: "Metal", type: "select", sortOrder: 0, sectionKey: "section_1", options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] },
    { key: "gold_purity", label: "Gold purity", type: "text", sortOrder: 1, sectionKey: "section_1" },
    { key: "silver_finish", label: "Silver finish", type: "text", sortOrder: 2, sectionKey: "section_1" },
  ],
} as unknown as FormBundle;

describe("Filling a branching form", () => {
  it("shows only the section the controlling answer leads to, and switches branches live", async () => {
    const user = userEvent.setup();
    render(<FormRenderer definition={onboarding} dynamicOptions={options} />);

    expect(screen.queryByLabelText(/^Name/)).toBeNull();
    expect(screen.queryByLabelText(/Company Name/)).toBeNull();

    await user.selectOptions(screen.getByRole("combobox", { name: /Customer type/ }), "individual");
    expect(screen.getByLabelText(/^Name/)).toBeTruthy();
    expect(screen.queryByLabelText(/Company Name/)).toBeNull();

    await user.selectOptions(screen.getByRole("combobox", { name: /Customer type/ }), "business");
    expect(screen.getByLabelText(/Company Name/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Name/)).toBeNull();
  });

  it("reads the option labels from Dropdown Master instead of a copy in the form", () => {
    render(<FormRenderer definition={onboarding} dynamicOptions={options} />);
    expect(screen.getByRole("option", { name: "Individual" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Business" })).toBeTruthy();
  });

  it("does not let a hidden required field block submission", async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    render(<FormRenderer definition={onboarding} dynamicOptions={options} onSubmit={async (answers) => { submitted.push(answers); }} />);

    await user.selectOptions(screen.getByRole("combobox", { name: /Customer type/ }), "individual");
    await user.type(screen.getByLabelText(/^Name/), "Synthetic Person");
    await user.click(screen.getByRole("button", { name: /Submit form/ }));

    expect(submitted).toEqual([{ customer_type: "individual", individual_name: "Synthetic Person" }]);
  });

  it("still enforces a required field inside the branch that was taken", async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    render(<FormRenderer definition={onboarding} dynamicOptions={options} onSubmit={async (answers) => { submitted.push(answers); }} />);

    await user.selectOptions(screen.getByRole("combobox", { name: /Customer type/ }), "business");
    await user.type(screen.getByLabelText(/Company Name/), "MK Jewels");
    await user.click(screen.getByRole("button", { name: /Submit form/ }));

    expect(submitted).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("GST Number is required");
  });

  it("renders a form saved before sections existed", () => {
    render(<FormRenderer definition={{ name: "Legacy", fields: [{ key: "visitor", label: "Visitor name", type: "text", sortOrder: 0 }] }} />);
    expect(screen.getByLabelText(/Visitor name/)).toBeTruthy();
  });
});

function OptionHarness({ initial = [] }: { initial?: readonly FormOption[] }) {
  const [options, setOptions] = useState<readonly FormOption[]>(initial);
  return <OptionListEditor onChange={setOptions} options={options} />;
}

describe("Entering dropdown options", () => {
  it("commits one option per Enter and offers the next input", async () => {
    const user = userEvent.setup();
    render(<OptionHarness />);

    await user.type(screen.getByLabelText("Option 1"), "Instagram{Enter}");
    expect(screen.getByText("Instagram")).toBeTruthy();
    await user.type(screen.getByLabelText("Option 2"), "Facebook{Enter}");
    await user.type(screen.getByLabelText("Option 3"), "Google{Enter}");

    expect(screen.getByLabelText("Option 4")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      expect.stringContaining("Instagram"), expect.stringContaining("Facebook"), expect.stringContaining("Google"),
    ]);
  });

  it("ignores an empty entry and refuses a duplicate", async () => {
    const user = userEvent.setup();
    render(<OptionHarness />);

    await user.type(screen.getByLabelText("Option 1"), "{Enter}");
    expect(screen.queryAllByRole("listitem")).toEqual([]);

    await user.type(screen.getByLabelText("Option 1"), "Instagram{Enter}");
    await user.type(screen.getByLabelText("Option 2"), " instagram {Enter}");
    expect(screen.queryAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText(/is already an option/)).toBeTruthy();
  });

  it("keeps the stable value when an option is renamed", async () => {
    const user = userEvent.setup();
    render(<OptionHarness initial={[{ value: "instagram", label: "Instagram" }]} />);

    await user.click(screen.getByLabelText("Edit Instagram"));
    await user.clear(screen.getByLabelText("Rename Instagram"));
    await user.type(screen.getByLabelText("Rename Instagram"), "Insta{Enter}");

    expect(screen.getByText("Insta")).toBeTruthy();
    expect(screen.getByText("instagram")).toBeTruthy();
  });

  it("deletes an option", async () => {
    const user = userEvent.setup();
    render(<OptionHarness initial={[{ value: "instagram", label: "Instagram" }, { value: "google", label: "Google" }]} />);

    await user.click(screen.getByLabelText("Delete Instagram"));
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([expect.stringContaining("Google")]);
  });
});

describe("Form builder internal keys", () => {
  it("allocates an unused key after a field was removed", () => {
    expect(nextFormFieldKey([
      { key: "field_1" },
      { key: "field_3" },
    ])).toBe("field_2");
  });

  it("keeps the normal field editor focused on respondent-facing settings", async () => {
    const user = userEvent.setup();
    render(<FormBuilder dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={() => {}} onSaved={async () => {}} />);

    await user.click(screen.getByRole("button", { name: "Text" }));

    const helper = screen.getByLabelText("Helper text");
    const placeholder = screen.getByLabelText("Placeholder");
    expect(screen.queryByLabelText("Internal key")).toBeNull();
    expect(helper.compareDocumentPosition(placeholder) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("Minimum length").closest("details")?.open).toBe(false);
    expect(screen.getByText("Advanced settings")).toBeTruthy();
  });
});

describe("Form builder follow-up questions", () => {
  it("connects an answer to a later question with plain-language controls", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={conditionalBundle} dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={() => {}} onSaved={async () => {}} />);

    await user.click(screen.getByLabelText("Edit Metal"));
    await user.selectOptions(screen.getByLabelText("Follow-up after Gold"), "gold_purity");

    expect(screen.getByText("If Gold is selected, ask Gold purity.")).toBeTruthy();
  });

  it("lets an author test the answer path and start the preview again", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={conditionalBundle} dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={() => {}} onSaved={async () => {}} />);

    await user.click(screen.getByLabelText("Edit Metal"));
    await user.selectOptions(screen.getByLabelText("Follow-up after Gold"), "gold_purity");
    await user.selectOptions(screen.getByLabelText("Metal"), "gold");
    expect(screen.getByLabelText("Gold purity")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Start preview again" }));
    expect(screen.queryByLabelText("Gold purity")).toBeNull();
  });
});
