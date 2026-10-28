// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "./api";
import { saveDraft } from "./api";
import { FormBuilder } from "./FormBuilder";

type Row = { id: string; master_type: string; label: string; value: string; sort_order: number; is_active: boolean };
const SEED: Row[] = [{ id: "m1", master_type: "lead_source", label: "Walk-in", value: "walk_in", sort_order: 0, is_active: true }];
const masters = vi.hoisted(() => ({ rows: [] as Row[], create: vi.fn() }));
vi.mock("@/features/dropdowns/api", () => ({
  loadMasterOptions: async () => masters.rows,
  toFormMasterOptions: (rows: typeof masters.rows) => rows.map((row) => ({ masterType: row.master_type, value: row.value, label: row.label })),
  createMasterList: masters.create,
}));
vi.mock("./api", async (importOriginal) => ({ ...await importOriginal<typeof import("./api")>(), saveDraft: vi.fn(async () => undefined), savePublishedForm: vi.fn(), formUsageImpact: vi.fn() }));

const bundle = {
  id: "00000000-0000-4000-8000-000000000a02", name: "Visit form", description: "", lifecycle: "draft", version: 1, family_id: "fam", record_name_field_key: null, permissions: { roles: ["staff"] },
  sections: [{ key: "section_1", title: "Section 1" }],
  fields: [{ key: "occasion", label: "Occasion", type: "select", sortOrder: 0, sectionKey: "section_1", options: [{ value: "wedding", label: "Wedding" }, { value: "birthday", label: "Birthday" }] }],
  submissionCount: 0,
} as unknown as FormBundle;
const options = { users: [], branches: [], departments: [], masters: [] };

describe("Form builder → Dropdown Master", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    masters.rows = [...SEED];
    masters.create.mockReset();
    masters.create.mockImplementation(async (masterType: string, rows: { value: string; label: string }[]) => {
      masters.rows = [...masters.rows, ...rows.map((row, index) => ({ id: `n${index}`, master_type: masterType, label: row.label, value: row.value, sort_order: index, is_active: true }))];
      return masterType;
    });
    vi.mocked(saveDraft).mockClear();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("adds a ticked list to Dropdown Master when the form is saved, even after the question is collapsed", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={options} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByLabelText("Edit Occasion"));
    await user.click(screen.getByRole("checkbox", { name: "Also add this dropdown to Dropdown Master" }));
    const name = screen.getByLabelText("Dropdown Master list name") as HTMLInputElement;
    expect(name.value).toBe("Occasion");
    // Collapsing the question used to lose the request silently.
    await user.click(screen.getByLabelText("Edit Occasion"));
    await user.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(masters.create).toHaveBeenCalledWith("occasion", [{ value: "wedding", label: "Wedding" }, { value: "birthday", label: "Birthday" }]);
    const savedFields = vi.mocked(saveDraft).mock.calls[0]![2] as unknown as { key: string; optionSource?: unknown; options?: unknown[] }[];
    const saved = savedFields.find((field) => field.key === "occasion")!;
    expect(saved.optionSource).toEqual({ kind: "master", masterType: "occasion" });
    expect(saved.options ?? []).toEqual([]);
  }, 30_000);

  it("adds the list at once with Add now and links to it in Dropdown Master", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={options} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByLabelText("Edit Occasion"));
    await user.click(screen.getByRole("checkbox", { name: "Also add this dropdown to Dropdown Master" }));
    await user.click(screen.getByRole("button", { name: "Add now" }));

    expect(await screen.findByText(/Added to Dropdown Master as/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open in Dropdown Master" });
    expect(link.getAttribute("href")).toBe("/dropdown-master?category=occasion");
    expect(link.getAttribute("target")).toBe("_blank");

    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(masters.create).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("warns before reusing the name of an existing list", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={options} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByLabelText("Edit Occasion"));
    await user.click(screen.getByRole("checkbox", { name: "Also add this dropdown to Dropdown Master" }));
    const name = screen.getByLabelText("Dropdown Master list name");
    await user.clear(name);
    await user.type(name, "Lead Source");
    expect(screen.getByText(/already exists/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add now" }) as HTMLButtonElement).disabled).toBe(true);
  }, 30_000);
});
