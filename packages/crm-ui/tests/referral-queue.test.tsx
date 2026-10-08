// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn(); const push = vi.fn(); const rpc = vi.fn();
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ refresh, push }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module
import { ReferralQueue, type ReferralItem } from "@/components/referral-queue";

const item: ReferralItem = { id: "referral-1", status: "PENDING", next_followup_date: null, remark: null, converted_client_id: null, followup_count: 1, crm_name: "CRM Name", assigned_doer: "Assigned Doer", given_by_client_id: "client-1", given_by_name: "Anita", referral_name: "Bina", referral_number: "9876543210", salesperson: "Sales A", history: "Prior call", history_count: 3, action_point: "Call after 6 PM" };
function renderQueue(items = [item], rosterNames: string[] = []) { return render(<ReferralQueue role="salesperson" branchId="branch-1" enteredByName="Test CRM" items={items} rosterNames={rosterNames} />); }
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.stubGlobal("crypto", { randomUUID: () => "10000000-0000-4000-8000-000000000001" }); });

describe("ReferralQueue legacy parity", () => {
  it("renders all ten legacy columns, assigned-doer fallback, and HIST badge", () => { renderQueue(); for (const label of ["CRM/DOER", "GIVEN BY CLIENT", "REFERRAL NAME", "REFERRAL NUMBER", "SALESPERSON", "STATUS", "NEXT FOLLOW UP", "LAST REMARK", "CONVERTED CLIENT", "ACTION"]) expect(screen.getByRole("columnheader", { name: label })).toBeTruthy(); expect(screen.getAllByText("Assigned Doer")).toHaveLength(1); expect(screen.getByText("HIST: 3")).toBeTruthy(); });
  it("uses referral-specific Today semantics and excludes overdue referrals", () => { renderQueue([{ ...item, next_followup_date: "2000-01-01" }]); expect(screen.getByText("NO REFERRALS FOUND.")).toBeTruthy(); });
  it("validates the legacy open follow-up conditions and saves through the parity RPC", async () => { rpc.mockResolvedValue({ error: null }); renderQueue(); fireEvent.click(screen.getByRole("button", { name: "FOLLOW UP FORM" })); for (const label of ["Follow Up Status", "Call Response", "Next Follow Up Date", "Entered By", "Follow Up Remark"]) expect(screen.getByLabelText(label)).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "SAVE FOLLOW UP" })); expect(screen.getByText("Next Follow Up Date is required.")).toBeTruthy(); fireEvent.change(screen.getByLabelText("Next Follow Up Date"), { target: { value: "2026-08-01" } }); fireEvent.change(screen.getByLabelText("Follow Up Remark"), { target: { value: "Called client" } }); fireEvent.click(screen.getByRole("button", { name: "SAVE FOLLOW UP" })); await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_referral_followup", expect.objectContaining({ p_referral_calling_id: "referral-1", p_followup_status: "PENDING", p_call_response: "CONNECTED", p_entered_by: "Test CRM", p_request_key: "10000000-0000-4000-8000-000000000001" }))); });
  it("keeps the exact five legacy tabs and searches normalized phone digits", () => { renderQueue([{ ...item, referral_number: "+91 98765 43210" }]); for (const tab of ["TODAY FOLLOW UP", "ALL PENDING", "INPROCESS", "ALL DONE", "CONVERTED TO CLIENT"]) expect(screen.getByRole("button", { name: tab })).toBeTruthy(); fireEvent.change(screen.getByPlaceholderText("SEARCH REFERRAL / PHONE / GIVEN BY"), { target: { value: "9876543210" } }); expect(screen.getByText("Bina")).toBeTruthy(); });
  it("syncs conversions explicitly and refreshes", async () => { rpc.mockResolvedValue({ data: 2, error: null }); renderQueue(); fireEvent.click(screen.getByRole("button", { name: "SYNC REFERRALS DATA" })); await waitFor(() => expect(rpc).toHaveBeenCalledWith("reconcile_referral_calling_conversions")); expect(refresh).toHaveBeenCalled(); expect(screen.getByText(/2 conversion\(s\) detected/)).toBeTruthy(); });
  it("shows the page title once, as the page heading (QA fix 2026-10-05)", () => { renderQueue(); expect(screen.getAllByText("REFERRALS CALLING")).toHaveLength(1); expect(screen.getByRole("heading", { level: 1, name: "REFERRALS CALLING" })).toBeTruthy(); });
});

describe("ReferralQueue roster, sorting and finding (owner request 2026-10-08)", () => {
  const pending = (id: string, extra: Partial<ReferralItem>): ReferralItem => ({ ...item, id, next_followup_date: "2099-01-01", ...extra });
  it("lists the current roster in CRM/DOER, not names saved on old records, and filters by roster name", () => {
    renderQueue([pending("a", { assigned_doer: null, crm_name: "Riya Shah", referral_name: "Current" }), pending("b", { assigned_doer: "Old Crm", referral_name: "Former" })], ["RIYA SHAH", "NEW PERSON"]);
    const options = Array.from((screen.getByLabelText("CRM/DOER") as HTMLSelectElement).options).map((option) => option.text);
    expect(options).toEqual(["CRM/DOER: ALL", "RIYA SHAH", "NEW PERSON", "NOT IN CURRENT ROSTER"]);
    fireEvent.click(screen.getByRole("button", { name: "ALL PENDING" }));
    fireEvent.change(screen.getByLabelText("CRM/DOER"), { target: { value: "RIYA SHAH" } });
    expect(screen.getByText("Current")).toBeTruthy(); expect(screen.queryByText("Former")).toBeNull();
    fireEvent.change(screen.getByLabelText("CRM/DOER"), { target: { value: "__off_roster__" } });
    expect(screen.getByText("Former")).toBeTruthy(); expect(screen.queryByText("Current")).toBeNull();
  });
  it("shows tab counts, puts the newest referral first and sorts on request", () => {
    renderQueue([pending("old", { referral_name: "Zed", created_at: "2026-09-01T10:00:00Z", next_followup_date: "2099-01-01" }), pending("new", { referral_name: "Amy", created_at: "2026-10-08T10:00:00Z", next_followup_date: "2099-02-01" })]);
    expect(screen.getByRole("button", { name: "ALL PENDING" }).textContent).toBe("ALL PENDING (2)");
    expect(screen.getByRole("button", { name: "TODAY FOLLOW UP" }).textContent).toBe("TODAY FOLLOW UP (0)");
    fireEvent.click(screen.getByRole("button", { name: "ALL PENDING" }));
    const names = () => screen.getAllByRole("row").slice(1).map((row) => row.querySelectorAll("td")[2]?.querySelector("div")?.textContent);
    expect(names()).toEqual(["Amy", "Zed"]);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "next_soonest" } });
    expect(names()).toEqual(["Zed", "Amy"]);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "referral" } });
    expect(names()).toEqual(["Amy", "Zed"]);
  });
  it("filters by status", () => {
    renderQueue([pending("a", { referral_name: "Called", status: "CALL CONNECTED" }), pending("b", { referral_name: "Waiting" })]);
    fireEvent.click(screen.getByRole("button", { name: "ALL PENDING" }));
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "CALL CONNECTED" } });
    expect(screen.getByText("Called")).toBeTruthy(); expect(screen.queryByText("Waiting")).toBeNull();
  });
});
