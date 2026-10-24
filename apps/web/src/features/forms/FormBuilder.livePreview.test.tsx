// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "./api";
import { FormBuilder } from "./FormBuilder";

vi.mock("@/features/dropdowns/api", () => ({ loadMasterOptions: async () => [], toFormMasterOptions: () => [] }));
vi.mock("./api", async (importOriginal) => ({ ...await importOriginal<typeof import("./api")>(), saveDraft: vi.fn(), savePublishedForm: vi.fn(), formUsageImpact: vi.fn() }));

const bundle = {
  id: "00000000-0000-4000-8000-000000000a01", name: "Introduction call", description: "", lifecycle: "draft", version: 1, family_id: "fam", record_name_field_key: null, permissions: { roles: ["staff"] },
  sections: [{ key: "section_1", title: "Section 1" }],
  fields: [
    { key: "interested", label: "Client Interested?", type: "radio", sortOrder: 0, sectionKey: "section_1", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
    { key: "budget", label: "Budget", type: "number", sortOrder: 1, sectionKey: "section_1", rule: { kind: "predicate", fieldKey: "interested", operator: "equals", value: "yes" } },
  ],
  submissionCount: 0,
} as unknown as FormBundle;
const options = { users: [], branches: [], departments: [], masters: [] };

describe("Form builder live preview", () => {
  beforeEach(() => { vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the editor and the real form side by side and updates the preview on every edit without saving", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={options} onClose={() => undefined} onSaved={async () => undefined} />);
    const preview = within(screen.getByRole("complementary", { name: "Live preview" }));
    expect(screen.getByRole("region", { name: "Fields" })).toBeTruthy();
    expect(preview.getByText("Client Interested?")).toBeTruthy();

    await user.click(screen.getByLabelText("Edit Client Interested?"));
    const question = screen.getAllByLabelText("Question")[0] as HTMLInputElement;
    await user.clear(question);
    await user.type(question, "Interested in Purchasing?");
    expect(preview.getByText("Interested in Purchasing?")).toBeTruthy();

    // Conditional questions behave as they will for the employee.
    expect(preview.queryByLabelText("Budget")).toBeNull();
    await user.click(preview.getByRole("radio", { name: "Yes" }));
    expect(preview.getByLabelText("Budget")).toBeTruthy();

    await user.click(screen.getByRole("checkbox", { name: "Required" }));
    expect(preview.getByText("Interested in Purchasing?").parentElement!.textContent).toContain("*");

    await user.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(screen.queryByRole("complementary", { name: "Live preview" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show preview" }));
    expect(screen.getByRole("complementary", { name: "Live preview" })).toBeTruthy();
    expect((screen.getAllByLabelText("Question")[0] as HTMLInputElement).value).toBe("Interested in Purchasing?");
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
  }, 30_000);
});
