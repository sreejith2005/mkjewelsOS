// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "./api";
import { saveDraft } from "./api";
import { FormBuilder } from "./FormBuilder";

vi.mock("@/features/dropdowns/api", () => ({
  loadMasterOptions: async () => [],
  toFormMasterOptions: () => [],
  createMasterList: vi.fn(),
}));
vi.mock("./api", async (importOriginal) => ({ ...await importOriginal<typeof import("./api")>(), saveDraft: vi.fn(async () => undefined), savePublishedForm: vi.fn(), formUsageImpact: vi.fn() }));

const bundle = {
  id: "00000000-0000-4000-8000-000000000a09", name: "Visit form", description: "", lifecycle: "published", version: 2, family_id: "fam", record_name_field_key: null, permissions: { roles: ["staff"] },
  sections: [{ key: "section_1", title: "Section 1" }],
  fields: [{ key: "occasion", label: "Occasion", type: "select", sortOrder: 0, sectionKey: "section_1", required: true, options: [{ value: "wedding", label: "Wedding" }, { value: "birthday", label: "Birthday" }] }],
  submissionCount: 0,
} as unknown as FormBundle;
const options = { users: [], branches: [], departments: [], masters: [] };

describe("Form builder, view only (leaders)", () => {
  beforeEach(() => { vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(saveDraft).mockClear(); });

  it("shows every question and its settings, locked, with nothing to save, add or remove", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={options} onClose={() => undefined} onSaved={async () => undefined} readOnly />);
    expect(screen.getByText("View only")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Save changes|Save draft/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add question/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Occasion" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Duplicate Occasion" })).toBeNull();
    expect((screen.getByDisplayValue("Visit form") as HTMLInputElement).matches(":disabled")).toBe(true);

    await user.click(screen.getByRole("button", { name: "View Occasion" }));
    const settings = screen.getByRole("group", { name: "Occasion settings (view only)" });
    expect((settings as HTMLFieldSetElement).disabled).toBe(true);
    expect((within(settings).getByDisplayValue("Occasion") as HTMLInputElement).matches(":disabled")).toBe(true);
    expect(saveDraft).not.toHaveBeenCalled();
  });
});
