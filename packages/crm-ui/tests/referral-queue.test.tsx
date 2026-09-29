// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn(); const push = vi.fn(); const rpc = vi.fn();
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ refresh, push }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module
import { ReferralQueue, type ReferralItem } from "@/components/referral-queue";

const item: ReferralItem = { id: "referral-1", status: "PENDING", next_followup_date: null, remark: null, converted_client_id: null, followup_count: 1, crm_name: "CRM Name", assigned_doer: "Assigned Doer", given_by_client_id: "client-1", given_by_name: "Anita", referral_name: "Bina", referral_number: "9876543210", salesperson: "Sales A", history: "Prior call", history_count: 3, action_point: "Call after 6 PM" };
function renderQueue(items = [item]) { return render(<ReferralQueue role="salesperson" branchId="branch-1" enteredByName="Test CRM" items={items} />); }
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.stubGlobal("crypto", { randomUUID: () => "10000000-0000-4000-8000-000000000001" }); });

describe("ReferralQueue legacy parity", () => {
  it("renders all ten legacy columns, assigned-doer fallback, and HIST badge", () => { renderQueue(); for (const label of ["CRM/DOER", "GIVEN BY CLIENT", "REFERRAL NAME", "REFERRAL NUMBER", "SALESPERSON", "STATUS", "NEXT FOLLOW UP", "LAST REMARK", "CONVERTED CLIENT", "ACTION"]) expect(screen.getByRole("columnheader", { name: label })).toBeTruthy(); expect(screen.getAllByText("Assigned Doer")).toHaveLength(2); expect(screen.getByText("HIST: 3")).toBeTruthy(); });
  it("uses referral-specific Today semantics and excludes overdue referrals", () => { renderQueue([{ ...item, next_followup_date: "2000-01-01" }]); expect(screen.getByText("NO REFERRALS FOUND.")).toBeTruthy(); });
  it("validates the legacy open follow-up conditions and saves through the parity RPC", async () => { rpc.mockResolvedValue({ error: null }); renderQueue(); fireEvent.click(screen.getByRole("button", { name: "FOLLOW UP FORM" })); for (const label of ["Follow Up Status", "Call Response", "Next Follow Up Date", "Entered By", "Follow Up Remark"]) expect(screen.getByLabelText(label)).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "SAVE FOLLOW UP" })); expect(screen.getByText("Next Follow Up Date is required.")).toBeTruthy(); fireEvent.change(screen.getByLabelText("Next Follow Up Date"), { target: { value: "2026-08-01" } }); fireEvent.change(screen.getByLabelText("Follow Up Remark"), { target: { value: "Called client" } }); fireEvent.click(screen.getByRole("button", { name: "SAVE FOLLOW UP" })); await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_referral_followup", expect.objectContaining({ p_referral_calling_id: "referral-1", p_followup_status: "PENDING", p_call_response: "CONNECTED", p_entered_by: "Test CRM", p_request_key: "10000000-0000-4000-8000-000000000001" }))); });
  it("keeps the exact five legacy tabs and searches normalized phone digits", () => { renderQueue([{ ...item, referral_number: "+91 98765 43210" }]); for (const tab of ["TODAY FOLLOW UP", "ALL PENDING", "INPROCESS", "ALL DONE", "CONVERTED TO CLIENT"]) expect(screen.getByRole("button", { name: tab })).toBeTruthy(); fireEvent.change(screen.getByPlaceholderText("SEARCH REFERRAL / PHONE / GIVEN BY"), { target: { value: "9876543210" } }); expect(screen.getByText("Bina")).toBeTruthy(); });
  it("syncs conversions explicitly and refreshes", async () => { rpc.mockResolvedValue({ data: 2, error: null }); renderQueue(); fireEvent.click(screen.getByRole("button", { name: "SYNC REFERRALS DATA" })); await waitFor(() => expect(rpc).toHaveBeenCalledWith("reconcile_referral_calling_conversions")); expect(refresh).toHaveBeenCalled(); expect(screen.getByText(/2 conversion\(s\) detected/)).toBeTruthy(); });
});
