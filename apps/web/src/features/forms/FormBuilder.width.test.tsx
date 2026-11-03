// @vitest-environment jsdom
// Question widths (owner request 2026-11-03): authors place questions side by side on wider screens.
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBundle } from "./api";
import { FormBuilder } from "./FormBuilder";

vi.mock("@/features/dropdowns/api", () => ({ loadMasterOptions: async () => [], toFormMasterOptions: () => [] }));
vi.mock("./api", async (importOriginal) => ({ ...await importOriginal<typeof import("./api")>(), saveDraft: vi.fn(), savePublishedForm: vi.fn(), formUsageImpact: vi.fn() }));

const bundle = {
  id: "00000000-0000-4000-8000-000000000b01", name: "Client queue", description: "", lifecycle: "draft", version: 1, family_id: "fam", record_name_field_key: null, permissions: { roles: ["staff"] },
  sections: [],
  fields: [
    { key: "client", label: "Client name", type: "text", sortOrder: 0 },
    { key: "mobile", label: "Mobile number", type: "phone", sortOrder: 1 },
  ],
  submissionCount: 0,
} as unknown as FormBundle;

describe("Form builder question width", () => {
  beforeEach(() => { vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), media: query, addEventListener: () => undefined, removeEventListener: () => undefined })); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("sets a question to half or a third of a row, shows it in the list and the live preview, and back to full", async () => {
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={() => undefined} onSaved={async () => undefined} />);
    await user.click(screen.getByLabelText("Edit Client name"));
    const widths = screen.getByRole("group", { name: "Client name width" });
    expect(within(widths).getByRole("button", { name: "Full" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(widths).getByRole("button", { name: "Half" }));
    expect(within(widths).getByRole("button", { name: "Half" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Short answer · half width|· half width/)).toBeTruthy();
    const preview = screen.getByRole("complementary", { name: "Live preview" });
    expect(preview.querySelector('[class~="md:col-span-3"]')).toBeTruthy();
    await user.click(within(widths).getByRole("button", { name: "Third" }));
    expect(preview.querySelector('[class~="md:col-span-2"]')).toBeTruthy();
    await user.click(within(widths).getByRole("button", { name: "Full" }));
    expect(preview.querySelector('[class~="md:col-span-2"]')).toBeNull();
    expect(screen.queryByText(/· (half|third) width/)).toBeNull();
  });
});
