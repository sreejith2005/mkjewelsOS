// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FranchiseManager } from "./FranchiseManager";

const api = vi.hoisted(() => ({
  loadFranchiseAdmin: vi.fn(),
  loadFranchiseInsights: vi.fn(),
  loadFranchiseHistory: vi.fn(),
  saveFranchise: vi.fn(),
  assignBranchFranchise: vi.fn(),
  grantScope: vi.fn(),
  revokeScope: vi.fn(),
}));
vi.mock("@jewelos/data/users/franchise", () => api);

const admin = {
  context: {
    enforcementEnabled: false,
    franchises: [{ id: "mum", name: "Mumbai", code: "MUM", city: "Mumbai", state: null, is_active: true }],
    branches: [
      { id: "bandra", name: "Bandra", code: "BANDRA", city: null, isActive: true, franchiseGroupId: "mum", locationKind: "store" as const, managerId: "p2" },
      { id: "expo", name: "Exhibition", code: "EXPO", city: null, isActive: true, franchiseGroupId: null, locationKind: "store" as const, managerId: null },
    ],
    grants: [{ id: "g1", userProfileId: "p1", employeeName: "Asha", authority: "director" as const, scopeLevel: "franchise" as const, franchiseGroupId: "mum", branchId: null, reason: "x" }],
  },
  readiness: {
    enforcementEnabled: false, enforcementSupported: false, mappingsComplete: false,
    unmappedActiveBranches: [{ id: "expo", name: "Exhibition", code: "EXPO" }],
    exhibitionLikeBranches: [], unmappedInactiveBranches: 0, leadersWithoutScope: [{ id: "p2", employeeName: "Ravi", role: "admin" }],
    recordsWithoutBranch: { task_instances: 3, clients: 0 }, usersDepartmentBranchMismatch: 0,
  },
};
const insights = {
  branchCounts: new Map([["bandra", 12], ["expo", 2]]),
  coverage: [
    { module: "tasks", label: "Tasks", enforced: true, pendingReason: null },
    { module: "crm_clients", label: "CRM project client data", enforced: false, pendingReason: "every CRM user still reads all clients" },
  ],
  history: [{ id: "h1", action: "org_scope_granted", label: "Scope granted", actorName: "Owner", createdAt: "2026-11-06T10:00:00Z" }],
};
const people = [{ id: "p1", employee_name: "Asha", account_status: "active" }, { id: "p2", employee_name: "Ravi", account_status: "active" }];

describe("FranchiseManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.loadFranchiseAdmin.mockResolvedValue(admin);
    api.loadFranchiseInsights.mockResolvedValue(insights);
    api.loadFranchiseHistory.mockResolvedValue(insights.history);
    api.assignBranchFranchise.mockResolvedValue(undefined);
  });
  afterEach(cleanup);

  it("shows isolation off, mapping gaps and exceptions", async () => {
    render(<FranchiseManager people={people} />);
    expect(await screen.findByText(/Stores without a franchise: Exhibition/)).toBeTruthy();
    expect(screen.getByText("Off")).toBeTruthy();
    expect(screen.getByText(/Leaders who would see only their own store: Ravi/)).toBeTruthy();
    expect(screen.getByText(/Tasks with no store: 3/)).toBeTruthy();
    expect(screen.queryByText(/Clients \(old CRM tables\) with no store/)).toBeNull();
    expect(screen.getByText(/Director · Mumbai/)).toBeTruthy();
  });

  it("maps a store through the audited API with its location type and reason", async () => {
    render(<FranchiseManager people={people} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set franchise for Exhibition" }));
    fireEvent.change(screen.getByLabelText("Franchise"), { target: { value: "mum" } });
    fireEvent.change(screen.getByLabelText("Location type"), { target: { value: "exhibition" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Owner approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.assignBranchFranchise).toHaveBeenCalledWith("expo", "mum", "exhibition", "Owner approved"));
    await waitFor(() => expect(api.loadFranchiseAdmin).toHaveBeenCalledTimes(2));
  });

  it("shows the store tree with counts and managers, module coverage and history", async () => {
    render(<FranchiseManager people={people} />);
    expect(await screen.findByText(/MUM · Mumbai · 1 store · 12 employees/)).toBeTruthy();
    expect(screen.getByText(/Store · 12 employees · Manager: Ravi/)).toBeTruthy();
    expect(screen.getByText("Stores not mapped yet")).toBeTruthy();
    expect(screen.getByText("CRM project client data")).toBeTruthy();
    expect(screen.getByText(/every CRM user still reads all clients/)).toBeTruthy();
    expect(screen.getByText(/Isolation can be switched on only when every section is ready/)).toBeTruthy();
    expect(screen.getByText("Scope granted")).toBeTruthy();
  });

  it("tells the page after a change so the directory refreshes", async () => {
    const onChanged = vi.fn();
    render(<FranchiseManager onChanged={onChanged} people={people} />);
    fireEvent.click(await screen.findByRole("button", { name: "Set franchise for Exhibition" }));
    fireEvent.change(screen.getByLabelText("Franchise"), { target: { value: "mum" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("still shows the stores and Set franchise when the history fails to load", async () => {
    api.loadFranchiseHistory.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    render(<FranchiseManager people={people} />);
    expect(await screen.findByRole("button", { name: "Set franchise for Bandra" })).toBeTruthy();
    expect(await screen.findByText(/statement timeout/)).toBeTruthy();
  });

  it("shows the server's reason when a grant is refused", async () => {
    api.grantScope.mockRejectedValue(new Error("Grant scope: This scope is already granted"));
    render(<FranchiseManager people={people} />);
    fireEvent.click(await screen.findByRole("button", { name: "Grant scope" }));
    fireEvent.change(screen.getByLabelText("Employee"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("Franchise"), { target: { value: "mum" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Director" } });
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    expect(await screen.findByText("Grant scope: This scope is already granted")).toBeTruthy();
    expect(api.grantScope).toHaveBeenCalledWith({ profileId: "p1", authority: "director", company: false, franchiseGroupId: "mum", branchId: null, reason: "Director" });
  });
});
