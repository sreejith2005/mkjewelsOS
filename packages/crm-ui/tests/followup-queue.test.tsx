// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const rpc = vi.fn();
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ refresh }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module

import { FollowupQueue, notBoughtCaseKind, type FollowupItem } from "@/components/followup-queue";

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
    rpc.mockResolvedValue({ data: 2, error: null }); renderQueue(); fireEvent.click(screen.getByRole("button", { name: "Sync Not Bought data" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("sync_not_bought_followups")); expect(refresh).toHaveBeenCalled(); expect(screen.getByText(/2 follow-up\(s\) added/)).toBeTruthy();
  });
});

describe("FollowupQueue roster, sorting and finding (owner request 2026-10-08)", () => {
  const row = (id: string, extra: Partial<FollowupItem>): FollowupItem => ({ ...item, id, ...extra });
  function renderItems(items: FollowupItem[], crmNames: string[]) { return render(<FollowupQueue role="salesperson" branchId="branch-1" items={items} crmNames={crmNames} enteredByName="Test CRM" />); }
  it("lists the roster and matches records whatever their saved capitalisation", () => {
    renderItems([row("a", { client_name: "Current", crm_name: "Riya Shah" }), row("b", { client_name: "Former", crm_name: "Old Crm" })], ["RIYA SHAH"]);
    expect(Array.from((screen.getByLabelText("CRM name") as HTMLSelectElement).options).map((option) => option.text)).toEqual(["CRM NAME: ALL", "RIYA SHAH", "NOT IN CURRENT ROSTER"]);
    fireEvent.change(screen.getByLabelText("CRM name"), { target: { value: "RIYA SHAH" } });
    expect(screen.getByText("Current")).toBeTruthy(); expect(screen.queryByText("Former")).toBeNull();
    fireEvent.change(screen.getByLabelText("CRM name"), { target: { value: "__off_roster__" } });
    expect(screen.getByText("Former")).toBeTruthy(); expect(screen.queryByText("Current")).toBeNull();
  });
  it("counts each tab and sorts by client name or visit date on request", () => {
    renderItems([row("a", { client_name: "Zara", visit_date: "2026-10-01" }), row("b", { client_name: "Asha", visit_date: "2026-09-01", status: "ALREADY PURCHASED FROM MK JEWELS" }), row("c", { client_name: "Meera", visit_date: "2026-10-05" })], []);
    expect(screen.getByRole("button", { name: "TODAY FOLLOW UP" }).textContent).toBe("Due today (2)");
    expect(screen.getByRole("button", { name: "ALL DONE" }).textContent).toBe("Done (1)");
    const names = () => screen.getAllByRole("row").slice(1).map((tr) => tr.querySelectorAll("td")[1]?.querySelector("a")?.textContent);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "client" } });
    expect(names()).toEqual(["Meera", "Zara"]);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "visit_newest" } });
    expect(names()).toEqual(["Meera", "Zara"]);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "visit_oldest" } });
    expect(names()).toEqual(["Zara", "Meera"]);
  });
});

describe("FollowupQueue saving legacy rows (fix 2026-10-08)", () => {
  function renderOne(extra: Partial<FollowupItem>) { return render(<FollowupQueue role="salesperson" branchId="branch-1" items={[{ ...item, ...extra }]} crmNames={[]} enteredByName="Test CRM" />); }
  it("starts a legacy NO row on PENDING, so the save is not refused for its status", async () => {
    rpc.mockResolvedValue({ error: null }); renderOne({ status: "NO" });
    fireEvent.click(screen.getByRole("button", { name: "ALL PENDING FOLLOW UP" }));
    fireEvent.click(screen.getByRole("button", { name: "FOLLOW UP FORM" }));
    expect(Array.from((screen.getByLabelText("Follow Up Status") as HTMLSelectElement).options).map((option) => option.text)).not.toContain("NO");
    fireEvent.change(screen.getByLabelText("Follow Up Remark"), { target: { value: "Called" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_not_bought_followup", expect.objectContaining({ p_followup_status: "PENDING" })));
  });
  it("says why a save was refused", async () => {
    rpc.mockResolvedValue({ error: { message: "you may only update follow-ups from your own branch" } }); renderOne({});
    fireEvent.click(screen.getByRole("button", { name: "FOLLOW UP FORM" }));
    fireEvent.change(screen.getByLabelText("Follow Up Remark"), { target: { value: "Called" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/on the CRM roster/)).toBeTruthy();
  });
});

describe("Not Bought case kinds in Client Database (2026-11-04)", () => {
  it("tells a buyer with a later not-bought visit from a client who never bought, and recovered from closed", () => {
    expect(notBoughtCaseKind({ status: "PENDING", purchase_context: { bought_before: true, bought_after: false } }).label).toBe("EARLIER BUYER, NOT BOUGHT THIS VISIT");
    expect(notBoughtCaseKind({ status: "PENDING", purchase_context: { bought_before: false, bought_after: false } }).label).toBe("NO PURCHASE ON RECORD");
    expect(notBoughtCaseKind({ status: "PENDING", purchase_context: { bought_before: false, bought_after: true } }).label).toBe("PURCHASED AFTER THIS VISIT");
    expect(notBoughtCaseKind({ status: "ALREADY PURCHASED FROM MK JEWELS", purchase_context: { bought_before: false, bought_after: false } }).label).toBe("RECOVERED: PURCHASED LATER");
    expect(notBoughtCaseKind({ status: "NOT INTERESTED", purchase_context: { bought_before: true, bought_after: false } }).label).toBe("CLOSED");
    expect(notBoughtCaseKind({ status: "PENDING", purchase_context: null }).label).toBe("PURCHASE HISTORY NOT LOADED");
  });

  it("offers an Overdue view of cases due before today", () => {
    render(<FollowupQueue role="salesperson" branchId="branch-1" items={[{ ...item, id: "late", client_name: "Late Client", next_followup_date: "2000-01-01" }, { ...item, id: "later", client_name: "Later Client", next_followup_date: "2999-01-01" }]} crmNames={[]} enteredByName="Test CRM" />);
    expect(screen.getByRole("button", { name: "OVERDUE FOLLOW UP" }).textContent).toBe("Overdue (1)");
    fireEvent.click(screen.getByRole("button", { name: "OVERDUE FOLLOW UP" }));
    expect(screen.getByText("Late Client")).toBeTruthy();
    expect(screen.queryByText("Later Client")).toBeNull();
  });
});
