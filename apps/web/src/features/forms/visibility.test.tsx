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
  it("maps a target question from an earlier question's actual answer choices", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const row = await openEditor(user, "Karat");
    await user.selectOptions(within(row).getByLabelText("Show Karat when question"), "metal");

    const answer = within(row).getByLabelText("Show Karat when answer") as HTMLSelectElement;
    expect(answer.options[1]?.text).toBe("Gold");
    expect(answer.options[2]?.text).toBe("Silver");
    await user.selectOptions(answer, "silver");
    expect(screen.getAllByText("Silver -> Ask Karat").length).toBeGreaterThan(0);
  });

  it("explains why the first question cannot have a previous-answer condition", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const row = await openEditor(user, "Metal");
    expect(within(row).queryByLabelText("Show Metal when question")).toBeNull();
    expect(within(row).getByText(/Add a choose-one question before this one/)).toBeTruthy();
  });

  it("keeps technical rule syntax out of the normal builder", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const row = await openEditor(user, "Karat");
    expect(within(row).queryByText("Advanced settings")).toBeNull();
    expect(within(row).queryByText("Add condition")).toBeNull();
    expect(within(row).queryByLabelText("Match all or any condition")).toBeNull();
  });

  it("drops the condition when the question it reads is deleted", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const row = await openEditor(user, "Karat");
    await user.selectOptions(within(row).getByLabelText("Show Karat when question"), "metal");
    expect(screen.getAllByText("Gold -> Ask Karat").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Remove Metal" }));

    expect(screen.queryByText("Gold -> Ask Karat")).toBeNull();
  });

  it("keeps internal keys out of the builder", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={dynamicOptions} onClose={() => undefined} onSaved={async () => undefined} />);

    const metalRow = await openEditor(user, "Metal");
    expect(within(metalRow).queryByRole("textbox", { name: "Internal key" })).toBeNull();
  });
});
