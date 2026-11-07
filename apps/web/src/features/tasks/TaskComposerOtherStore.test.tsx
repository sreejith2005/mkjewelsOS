// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/types";
import type { TaskReferenceData } from "./api";
import { TaskComposer } from "./TaskComposer";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const api = vi.hoisted(() => ({ loadAssignmentLocations: vi.fn(), searchAssignmentRecipients: vi.fn() }));
vi.mock("@jewelos/data/users/franchise", () => api);

const data = {
  branches: [{ id: "bandra", name: "Bandra" }],
  categories: [],
  priorities: [{ id: "priority-high", label: "High", value: "high" }],
  departments: [{ branch_id: "bandra", id: "sales", name: "Sales" }],
  designations: [],
  forms: [],
  templates: [],
  users: [
    { branch_id: "bandra", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "sales", employee_code: "E-1", employee_name: "Author", first_name: "Author", id: "author", last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
  ],
} as TaskReferenceData;
const profile = { branch_id: "bandra", department_id: "sales", designation_id: null, id: "author", tenant_id: "tenant-1", user_role: "staff" } as UserProfile;
const locations = {
  ownBranchId: "bandra", ownFranchiseId: "mum",
  locations: [
    { id: "mum", name: "Mumbai", stores: [{ id: "bandra", name: "Bandra" }, { id: "andheri", name: "Andheri" }] },
    { id: "ahd", name: "Ahmedabad", stores: [{ id: "a2", name: "Ahmedabad 2" }] },
  ],
};

function renderComposer(overrides: Partial<Parameters<typeof TaskComposer>[0]> = {}) {
  render(<TaskComposer data={data} onClose={vi.fn()} onCreated={vi.fn()} onSave={vi.fn().mockResolvedValue("task-1")} onUploadAttachment={vi.fn()} profile={profile} {...overrides} />);
}

describe("TaskComposer: someone at another store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.loadAssignmentLocations.mockResolvedValue(locations);
    api.searchAssignmentRecipients.mockImplementation(async (_context: unknown, storeId: string) => ({
      rows: storeId === "andheri"
        ? [{ id: "andheri-1", name: "Meera Joshi", designation: "Sales", storeId: "andheri", storeName: "Andheri", departmentId: "sales-andheri", franchiseId: "mum", franchiseName: "Mumbai" }]
        : [],
      hasMore: false,
    }));
  });
  afterEach(cleanup);

  it("is not offered without the cross-location permission", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    expect(screen.queryByRole("button", { name: "Someone at another store" })).toBeNull();
  });

  it("assigns a one-time task to an employee of another store, naming that store and department", async () => {
    const onSave = vi.fn().mockResolvedValue("task-1");
    renderComposer({ canAssignOtherStores: true, onSave });
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Help with stock count" } });
    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.click(screen.getByRole("button", { name: "Someone at another store" }));
    await waitFor(() => expect(api.loadAssignmentLocations).toHaveBeenCalledWith({ kind: "task" }));
    fireEvent.change(await screen.findByLabelText("Store"), { target: { value: "andheri" } });
    fireEvent.click(await screen.findByRole("button", { name: /Meera Joshi/ }));
    expect(screen.getByRole("button", { name: /Remove Meera Joshi/ }).textContent).toContain("Mumbai · Andheri");
    fireEvent.click(screen.getByRole("button", { name: /Due Date/i }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2030-10-06" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign Task" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const [payload, doers] = onSave.mock.calls[0] as [Record<string, unknown>, string[]];
    expect(doers).toEqual(["andheri-1"]);
    expect(payload.branch_id).toBe("andheri");
    expect(payload.department_id).toBe("sales-andheri");
  }, 20_000);
});
