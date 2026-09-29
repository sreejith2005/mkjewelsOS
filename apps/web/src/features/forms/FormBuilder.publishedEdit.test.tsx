// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormBuilder } from "./FormBuilder";
import { formUsageImpact, savePublishedForm, type FormBundle } from "./api";

vi.mock("./api", () => ({ formUsageImpact: vi.fn(), savePublishedForm: vi.fn(), saveDraft: vi.fn() }));
vi.mock("@/features/dropdowns/api", () => ({ loadMasterOptions: vi.fn(async () => []), toFormMasterOptions: vi.fn(() => []) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const bundle = {
  id: "form-1", name: "Enquiry", lifecycle: "published", version: 1,
  permissions: { roles: ["staff"] }, sections: [{ key: "section_1", title: "Section 1" }],
  fields: [{ key: "name", label: "Name", type: "text", sortOrder: 0, sectionKey: "section_1" }],
} as unknown as FormBundle;

describe("published form edit warning", () => {
  it("names connected work and saves only after confirmation", async () => {
    vi.mocked(formUsageImpact).mockResolvedValue({
      form: { id: "form-1", name: "Enquiry", version: 1, lifecycle: "published" },
      flows: [{ id: "flow-1", name: "Sales FMS", version: 1, status: "published", stages: ["Start"], activeInstances: 1 }],
      taskTemplates: [], tasks: [], starterAssignments: [], submissions: 0,
    });
    vi.mocked(savePublishedForm).mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<FormBuilder bundle={bundle} dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={vi.fn()} onSaved={vi.fn(async () => {})} />);
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0]?.[0]).toContain("Sales FMS");
    expect(savePublishedForm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(savePublishedForm).toHaveBeenCalledOnce());
  });
});
