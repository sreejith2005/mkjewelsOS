// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormBundle, FormDeletionImpact } from "@/features/forms/api";
import type { UserProfile } from "@/types";
import { FormsPage } from "./FormsPage";

const mocks = vi.hoisted(() => ({
  loadForms: vi.fn(),
  formDeletionImpact: vi.fn(),
  deleteForm: vi.fn(),
}));

vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "admin", tenant_id: "tenant", user_role: "admin" } as UserProfile }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/forms/FormBuilder", () => ({ FormBuilder: () => <div>Builder</div> }));
vi.mock("@/features/forms/api", () => ({
  loadForms: mocks.loadForms,
  formDeletionImpact: mocks.formDeletionImpact,
  deleteForm: mocks.deleteForm,
  loadFormDynamicOptions: async () => ({ users: [], branches: [], departments: [], masters: [] }),
  deletedFormBundle: () => null,
  archiveForm: vi.fn(), publishForm: vi.fn(), publishAsNewForm: vi.fn(), reviewSubmission: vi.fn(),
  startFmsFromFormSubmission: vi.fn(), submitForm: vi.fn(),
}));

const bundle = {
  id: "enquiry", family_id: "family", name: "Enquiry", description: "", version: 2, lifecycle: "published",
  permissions: { roles: ["staff"] }, sections: [], fields: [], submissionCount: 4,
} as unknown as FormBundle;

/** A form that collected answers and drives a live workflow — the case that used to be undeletable. */
const impact: FormDeletionImpact = {
  form: { id: "enquiry", name: "Enquiry", version: 2, lifecycle: "published" },
  submissions: 4, taskTemplates: 0, tasks: 1, starterAssignments: 0,
  flows: [{ id: "flow", name: "Order intake", version: 3, status: "published", stages: ["Collect details"], activeInstances: 2, action: "reverted_to_draft" }],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const openDeleteDialog = async () => {
  mocks.loadForms.mockResolvedValue({ bundles: [bundle], submissions: [] });
  mocks.formDeletionImpact.mockResolvedValue(impact);
  const user = userEvent.setup();
  render(<FormsPage />);
  await user.click(await screen.findByRole("button", { name: /Delete/ }));
  return user;
};

describe("Deleting a form that is in use", () => {
  it("warns what will happen before anything is deleted", async () => {
    const user = await openDeleteDialog();

    const dialog = await screen.findByText(/Delete Enquiry \(v2\)\?/);
    expect(dialog).toBeTruthy();
    expect(await screen.findByText(/4 submissions stay and stay readable/)).toBeTruthy();
    expect(screen.getByText(/1 task stop/)).toBeTruthy();
    expect(screen.getByText(/This form is part of a workflow/)).toBeTruthy();
    expect(screen.getByText(/Order intake v3/)).toBeTruthy();
    expect(screen.getByText(/Goes off the air and waits as a draft/)).toBeTruthy();
    expect(screen.getByText(/2 runs already under way keep going/)).toBeTruthy();
    expect(mocks.deleteForm).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(mocks.deleteForm).not.toHaveBeenCalled();
  });

  it("says again afterwards that the workflow needs a new form", async () => {
    const user = await openDeleteDialog();
    mocks.deleteForm.mockResolvedValue(impact);

    await user.click(await screen.findByRole("button", { name: /Delete this form/ }));

    expect(mocks.deleteForm).toHaveBeenCalledWith("enquiry");
    expect(await screen.findByText(/Enquiry was deleted/)).toBeTruthy();
    expect(screen.getByText(/Went off the air and is waiting as a draft/)).toBeTruthy();
    expect(screen.getByText(/Open FMS to give the affected step a new form/)).toBeTruthy();
  });

  it("keeps the form when the server refuses", async () => {
    const user = await openDeleteDialog();
    mocks.deleteForm.mockRejectedValue(new Error("Delete form: Only authorized active form authors can delete this form"));

    await user.click(await screen.findByRole("button", { name: /Delete this form/ }));

    expect(await screen.findByText(/Only authorized active form authors/)).toBeTruthy();
    expect(screen.queryByText(/Enquiry was deleted/)).toBeNull();
  });

  it("does not claim a workflow is affected when none is", async () => {
    mocks.loadForms.mockResolvedValue({ bundles: [bundle], submissions: [] });
    mocks.formDeletionImpact.mockResolvedValue({ ...impact, submissions: 0, tasks: 0, flows: [] });
    const user = userEvent.setup();
    render(<FormsPage />);

    await user.click(await screen.findByRole("button", { name: /Delete/ }));

    expect(await screen.findByText(/Nobody has filled this form in/)).toBeTruthy();
    expect(screen.queryByText(/part of a workflow/)).toBeNull();
  });
});

describe("Opening the Forms workspace", () => {
  it("replaces the library with the full builder instead of opening a modal", async () => {
    mocks.loadForms.mockResolvedValue({ bundles: [], submissions: [] });
    const user = userEvent.setup();
    render(<FormsPage />);

    await user.click(await screen.findByRole("button", { name: "New form" }));

    expect(screen.getByText("Builder")).toBeTruthy();
    expect(screen.queryByText("Forms Library")).toBeNull();
  });
});

