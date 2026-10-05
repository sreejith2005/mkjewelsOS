// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn(); const rpc = vi.fn(); const from = vi.fn();
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from }) }));
import { AllocationManager } from "@/components/allocation-manager";

const branchId = "10000000-0000-4000-8000-000000000401";
const otherBranchId = "10000000-0000-4000-8000-000000000402";
const branches = [{ id: branchId, name: "Test Branch" }, { id: otherBranchId, name: "Other Branch" }];
const candidates = [{ id: "60000000-0000-4000-8000-000000000401", name: "Anu Shah" }, { id: "60000000-0000-4000-8000-000000000402", name: "Renamed CRM" }];
const roster = [{ id: "50000000-0000-4000-8000-000000000401", crm_name: "Pending CRM", active: true, pending_count: 2, crm_user_id: null }];
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("AllocationManager legacy roster controls", () => {
  it("adds through the normalized roster RPC and reports the legacy feedback", async () => {
    rpc.mockResolvedValue({ error: null });
    render(<AllocationManager role="branch_manager" branchId={branchId} branches={branches} date="2026-07-24" unavailableNames={[]} roster={[]} candidates={candidates} />);
    fireEvent.change(screen.getByLabelText("CRM name"), { target: { value: candidates[0]!.id } }); fireEvent.click(screen.getByRole("button", { name: "ADD" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("manage_crm_roster", expect.objectContaining({ p_operation: "ADD", p_crm_name: "Anu Shah", p_crm_user_id: candidates[0]!.id, p_branch_id: branchId })));
    expect(screen.getByRole("status").textContent).toContain("CRM / BRANCH ADDED SUCCESSFULLY.");
  });

  it("supports legacy-equivalent edit and delete actions", async () => {
    rpc.mockResolvedValue({ error: null }); const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AllocationManager role="branch_manager" branchId={branchId} branches={branches} date="2026-07-24" unavailableNames={[]} roster={roster} candidates={candidates} />);
    fireEvent.click(screen.getByRole("button", { name: "EDIT" })); expect(screen.getByRole("button", { name: "UPDATE" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("CRM name"), { target: { value: candidates[1]!.id } }); fireEvent.click(screen.getByRole("button", { name: "UPDATE" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("manage_crm_roster", expect.objectContaining({ p_operation: "UPDATE", p_roster_id: roster[0]!.id, p_crm_user_id: candidates[1]!.id })));
    fireEvent.click(screen.getByRole("button", { name: "DELETE" })); await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("manage_crm_roster", { p_operation: "DELETE", p_roster_id: roster[0]!.id }));
  });

  it("requires a synced user: nothing typed or unpicked is saved", async () => {
    render(<AllocationManager role="branch_manager" branchId={branchId} branches={branches} date="2026-07-24" unavailableNames={[]} roster={[]} candidates={candidates} />);
    expect(screen.getByLabelText("CRM name").tagName).toBe("SELECT");
    fireEvent.click(screen.getByRole("button", { name: "ADD" }));
    expect(screen.getByRole("status").textContent).toContain("PLEASE SELECT CRM NAME.");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lists the synced users of the branch the entry is saved to", async () => {
    rpc.mockResolvedValue({ data: [{ id: "60000000-0000-4000-8000-000000000499", name: "Other Branch Person", role: "salesperson" }], error: null });
    render(<AllocationManager role="super_admin" branchId={branchId} branches={branches} date="2026-07-24" unavailableNames={[]} roster={[]} candidates={candidates} />);
    fireEvent.change(screen.getByLabelText("Branch name"), { target: { value: otherBranchId } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("crm_roster_candidates", { p_branch_id: otherBranchId }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Other Branch Person" })).toBeTruthy());
    expect(screen.queryByRole("option", { name: "Anu Shah" })).toBeNull();
  });
});
