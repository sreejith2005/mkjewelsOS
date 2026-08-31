// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormTemplateDefinition } from "@jewelos/core";

vi.mock("@jewelos/api-client", () => ({ supabase: {} }));
vi.mock("@/features/dropdowns/api", () => ({
  loadMasterOptions: async () => [],
  toFormMasterOptions: () => [],
  createMasterList: async () => "list",
  invalidateMasterOptions: () => undefined,
}));
vi.mock("./api", () => ({ saveDraft: async () => undefined, savePublishedForm: async () => undefined }));

import { FormBuilder } from "./FormBuilder";
import { FormRenderer, type DynamicOptions } from "./FormRenderer";

afterEach(cleanup);

const dynamicOptions: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };

// One dropdown, then a follow-up asked only for one of its answers.
const conditional: FormTemplateDefinition = {
  name: "Enquiry",
  fields: [
    { key: "metal", label: "Metal", type: "select", sortOrder: 0, required: true,
      options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] },
    { key: "karat", label: "Karat", type: "text", sortOrder: 1, required: true,
      rule: { kind: "predicate", fieldKey: "metal", operator: "equals", value: "gold" } },
    { key: "notes", label: "Notes", type: "text", sortOrder: 2 },
  ],
};

describe("Filling a form with conditional questions", () => {
  it("reveals and hides the follow-up as the controlling answer changes", async () => {
    const user = userEvent.setup();
    render(<FormRenderer definition={conditional} dynamicOptions={dynamicOptions} />);

    expect(screen.queryByLabelText(/Karat/)).toBeNull();
    expect(screen.getByLabelText(/Notes/)).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox", { name: /Metal/ }), "gold");
    expect(screen.getByLabelText(/Karat/)).toBeTruthy();

    await user.selectOptions(screen.getByRole("combobox", { name: /Metal/ }), "silver");
    expect(screen.queryByLabelText(/Karat/)).toBeNull();
  });

  it("does not require a question the answers hid", async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    render(<FormRenderer definition={conditional} dynamicOptions={dynamicOptions} onSubmit={async (answers) => { submitted.push(answers); }} />);

    await user.selectOptions(screen.getByRole("combobox", { name: /Metal/ }), "silver");
    await user.click(screen.getByRole("button", { name: /Submit form/ }));

    expect(submitted).toEqual([{ metal: "silver" }]);
  });

  it("still requires the question the answers revealed", async () => {
    const user = userEvent.setup();
    const submitted: unknown[] = [];
    render(<FormRenderer definition={conditional} dynamicOptions={dynamicOptions} onSubmit={async (answers) => { submitted.push(answers); }} />);

    await user.selectOptions(screen.getByRole("combobox", { name: /Metal/ }), "gold");
    await user.click(screen.getByRole("button", { name: /Submit form/ }));

    expect(submitted).toEqual([]);
    expect(screen.getByRole("alert").textContent).toContain("Karat is required");
  });
});

const bundle = {
  id: "template-1", name: "Enquiry", description: "", lifecycle: "draft", permissions: { roles: ["staff"] },
  sections: [{ key: "section_1", title: "Section 1" }],
  fields: [
    { key: "metal", label: "Metal", type: "select", sortOrder: 0, sectionKey: "section_1",
      options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] },
    { key: "karat", label: "Karat", type: "text", sortOrder: 1, sectionKey: "section_1" },
  ],
  submissionCount: 0,
} as unknown as Parameters<typeof FormBuilder>[0]["bundle"];

const rowFor = (label: string) => screen.getByRole("button", { name: `Edit ${label}` }).closest("article") as HTMLElement;
const openEditor = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.click(screen.getByRole("button", { name: `Edit ${label}` }));
  return rowFor(label);
};

describe("Authoring a conditional question", () => {
  it("shows a question only when an earlier answer matches", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const row = await openEditor(user, "Karat");
    await user.click(within(row).getByLabelText(/Only when earlier answers match/));

    // The first comparison defaults to the only earlier question and its first answer.
    expect((within(row).getByRole("combobox", { name: "Question" }) as HTMLSelectElement).value).toBe("metal");
    expect((within(row).getByRole("combobox", { name: "Answer" }) as HTMLSelectElement).value).toBe("gold");
    expect(screen.getAllByText(/Shown when Metal is gold/).length).toBeGreaterThan(0);

    await user.selectOptions(within(row).getByRole("combobox", { name: "Answer" }), "silver");
    expect(screen.getAllByText(/Shown when Metal is silver/).length).toBeGreaterThan(0);
  });

  it("offers the first question no conditions, because nothing comes before it", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const row = await openEditor(user, "Metal");
    expect(within(row).queryByLabelText(/Only when earlier answers match/)).toBeNull();
    expect(within(row).getByText(/Add a question before this one/)).toBeTruthy();
  });

  it("combines several comparisons with all or any", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const row = await openEditor(user, "Karat");
    await user.click(within(row).getByLabelText(/Only when earlier answers match/));
    await user.click(within(row).getByRole("button", { name: /Add condition/ }));

    await user.selectOptions(within(row).getByRole("combobox", { name: /Match all or any condition/ }), "any");
    const answers = within(row).getAllByRole("combobox", { name: "Answer" });
    await user.selectOptions(answers[1]!, "silver");

    expect(screen.getAllByText(/Shown when Metal is gold or Metal is silver/).length).toBeGreaterThan(0);
  });

  it("drops the condition when the question it reads is deleted", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const row = await openEditor(user, "Karat");
    await user.click(within(row).getByLabelText(/Only when earlier answers match/));
    expect(screen.getAllByText(/Shown when Metal is gold/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Remove Metal" }));

    expect(screen.queryByText(/Shown when Metal/)).toBeNull();
  });

  it("keeps internal keys out of the builder", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const metalRow = await openEditor(user, "Metal");
    expect(within(metalRow).queryByRole("textbox", { name: "Internal key" })).toBeNull();
  });
});
