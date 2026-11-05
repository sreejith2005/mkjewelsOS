// @vitest-environment jsdom
// CRM dashboard operations cards (owner request 2026-11-04): source-backed numbers with their
// definitions, each opening the matching Queue / Client Database view or insight records.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/crm-port/runtime", () => ({ crmSupabase: () => ({ rpc }) }));
vi.mock("@/crm-port/use-crm-refresh", () => ({ useCrmRefresh: () => undefined }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

import { CrmOperationsSummary, parseOperationsSummary, periodRange, purchaseConversion } from "@/components/dashboard-insights/CrmOperationsSummary";

const summary = {
  from: "2026-11-04", to: "2026-11-04", today: "2026-11-04", generated_at: "2026-11-04T06:30:00Z",
  queue_pending: 4, queue_registered: 9, walkin_forms_completed: 5, store_visits: 8, visits_with_outcome: 6, purchase_visits: 3, not_bought_visits: 2, new_leads: 1,
  followups_open: 40, followups_due_now: 12, followups_overdue: 7, followup_contacts: 15, followups_recovered: 2,
  referrals_active: 11, referrals_pending_outreach: 6, referrals_converted: 3,
};
afterEach(() => { cleanup(); rpc.mockReset(); });

describe("operations summary rules", () => {
  it("uses Asia/Kolkata business periods: week from Monday, month from the 1st", () => {
    expect(periodRange("today", "2026-11-04")).toEqual({ from: "2026-11-04", to: "2026-11-04" });
    expect(periodRange("this_week", "2026-11-04")).toEqual({ from: "2026-11-02", to: "2026-11-04" });
    expect(periodRange("this_week", "2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(periodRange("this_month", "2026-11-04")).toEqual({ from: "2026-11-01", to: "2026-11-04" });
  });
  it("states the conversion over visits with a saved outcome and never divides by zero", () => {
    expect(purchaseConversion({ purchase_visits: 3, visits_with_outcome: 6 })).toBe(50);
    expect(purchaseConversion({ purchase_visits: 0, visits_with_outcome: 0 })).toBeNull();
  });
  it("refuses a malformed response instead of showing zeros", () => {
    expect(() => parseOperationsSummary({ ...summary, queue_pending: "4" })).toThrow();
    expect(() => parseOperationsSummary(null)).toThrow();
  });
});

describe("CrmOperationsSummary", () => {
  it("reads today's numbers for the chosen branch and links each card to its records", async () => {
    rpc.mockResolvedValue({ data: summary, error: null });
    const onOpenInsight = vi.fn();
    render(<CrmOperationsSummary branches={[{ id: "b1", name: "Flagship" }]} onOpenInsight={onOpenInsight} />);
    await screen.findByText("Waiting in queue");
    expect(rpc).toHaveBeenCalledWith("get_crm_operations_summary_v1", expect.objectContaining({ p_from: expect.any(String), p_to: expect.any(String) }));
    expect(screen.getByRole("link", { name: /Overdue 7/ }).getAttribute("href")).toBe("/clients?preset=not_bought&tab=overdue");
    expect(screen.getByRole("link", { name: /Due now 12/ }).getAttribute("href")).toBe("/clients?preset=not_bought&tab=today");
    expect(screen.getByRole("link", { name: /Referred people converted 3/ }).getAttribute("href")).toBe("/clients?preset=referrals_received&tab=converted");
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText(/Not invoiced sales/)).toBeTruthy();
    expect(screen.queryByText(/revenue|₹/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Purchase visits 3/ }));
    expect(onOpenInsight).toHaveBeenCalledWith("purchases", { from: "2026-11-04", to: "2026-11-04" }, "");
    fireEvent.change(screen.getByLabelText("Operations branch"), { target: { value: "b1" } });
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("get_crm_operations_summary_v1", expect.objectContaining({ p_branch_id: "b1" })));
    await waitFor(() => expect(screen.getByRole("link", { name: /Overdue 7/ }).getAttribute("href")).toBe("/clients?preset=not_bought&tab=overdue&branch=b1"));
  });
  it("shows a read failure as an error, not as empty numbers", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } });
    render(<CrmOperationsSummary branches={[]} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Waiting in queue")).toBeNull();
  });
});
