// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const rpc = vi.fn();
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ refresh }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module

import { FollowupQueue, type FollowupItem } from "@/components/followup-queue";

const item: FollowupItem = { id: "followup-1", client_id: "client-1", reference_number: "REF-1", status: "PENDING", next_followup_date: null, remark: null, branch_id: "branch-1", client_name: "Anita", phone: "9012345678", crm_name: "CRM A", visit_date: "2026-07-25", reason: "Price", seen_categories: "Ring", product_requirement: "Daily wear", product_seen_remark: "Saw a ring", action_point: "Call after salary day", followup_count: 2, history_count: 3, remark_history: "Previous note" };
function renderQueue() { return render(<FollowupQueue role="salesperson" branchId="branch-1" items={[item]} crmNames={["CRM A"]} enteredByName="Test CRM" />); }

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("FollowupQueue legacy parity", () => {
  it("renders all twelve legacy columns and FU/HIST badges", () => {
    renderQueue();
    for (const label of ["CRM Name", "Client Name", "Number", "Client Visit Date", "Next Follow Up", "Reason", "Seen Categories", "Product Requirement", "Remark/Product Seen", "Follow Up Remark", "Action Point", "Action"]) expect(screen.getByRole("columnheader", { name: label })).toBeTruthy();
    expect(screen.getByText("FU: 2")).toBeTruthy(); expect(screen.getByText("HIST: 3")).toBeTruthy();
  });
  it("uses the legacy field order, requires a remark only while not done, and performs one save RPC", async () => {
    rpc.mockResolvedValue({ error: null }); renderQueue(); fireEvent.click(screen.getByRole("button", { name: "FOLLOW UP FORM" }));
    expect(screen.getAllByLabelText("Follow Up Status")).toHaveLength(1); expect(screen.getAllByLabelText("Next Follow Up Date")).toHaveLength(1); expect(screen.getAllByLabelText("Call Response")).toHaveLength(1); expect(screen.getAllByLabelText("Entered By")).toHaveLength(1); expect(screen.getAllByLabelText("Follow Up Remark")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Save" })); expect(await screen.findByText(/Follow Up Remark is required/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Follow Up Remark"), { target: { value: "Called client" } }); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_not_bought_followup", expect.objectContaining({ p_followup_id: "followup-1", p_call_response: "CONNECTED", p_followup_status: "PENDING" })));
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("syncs explicitly and refreshes", async () => {
    rpc.mockResolvedValue({ data: 2, error: null }); renderQueue(); fireEvent.click(screen.getByRole("button", { name: "SYNC NOT BOUGHT DATA" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("sync_not_bought_followups")); expect(refresh).toHaveBeenCalled(); expect(screen.getByText(/2 follow-up\(s\) added/)).toBeTruthy();
  });
});
