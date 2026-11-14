// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerListFilterOptions, CustomerListPage, CustomerListRow } from "@jewelos/core";

const mocks = vi.hoisted(() => ({ list: vi.fn(), filters: vi.fn(), profile: vi.fn(), timeline: vi.fn() }));
vi.mock("@/features/customers/api", () => ({
  CUSTOMER_LIST_PAGE_SIZE: 50,
  loadCustomerList: mocks.list, loadCustomerListFilters: mocks.filters, loadCustomerProfile: mocks.profile, loadCustomerTimeline: mocks.timeline,
}));

import { CustomerMasterPage } from "./CustomerMasterPage";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
const row = (name: string, code: string): CustomerListRow => ({
  client_id: code, client_code: code, household_code: "MKF-100001", primary_name: name, primary_phone: "919820000001", segment: "lead",
  lifecycle_stage: "engaged", city: "Mumbai", community: "JAIN", first_source: "runo", first_seen_at: "2026-11-01T05:30:00Z",
  last_contacted_at: null, last_attempt_at: "2026-11-02T06:30:00Z", interaction_count: 2, successful_interaction_count: 0, next_follow_up_at: null,
});
const pageOf = (rows: CustomerListRow[], total = rows.length): CustomerListPage => ({ total, rows });
const options: CustomerListFilterOptions = {
  total: 120, cities: [{ value: "Mumbai", count: 80 }, { value: "Pune", count: 40 }], communities: [{ value: "JAIN", count: 30 }],
  first_sources: [{ value: "runo", label: "Runo calling", count: 120 }], segments: { lead: 120 }, import: [],
};

beforeEach(() => {
  mocks.list.mockResolvedValue(pageOf([row("Asha Jain", "MKC-100001")], 120));
  mocks.filters.mockResolvedValue(options);
  mocks.profile.mockResolvedValue({ client: { city: "Mumbai", referral_code: "MKREF-100001" }, family: null, phones: [{ phone: "919820000001", kind: "primary" }, { phone: "919820000002", kind: "billing" }],
    names: [{ name: "Asha Jain", source: "runo", last_seen_at: "2026-11-02T06:30:00Z" }, { name: "Asha J", source: "runo", last_seen_at: "2026-10-01T06:30:00Z" }], identifiers: [], referred_by: null, field_sources: {}, needs_review_count: 0 });
  mocks.timeline.mockResolvedValue([{ interaction_id: "i1", interaction_code: "MKI-1000001", occurred_at: "2026-11-02T06:30:00Z", channel: "call", direction: "outbound", purpose: "enquiry",
    outcome: "Not contacted", result: "not_connected", successful: false, non_contact_reason: "Not picking", notes: null, source: "runo", staff: "Priya Nair", attended_by: null, branch: "MK Bandra",
    products: [], follow_ups: [{ code: "MKFU-100001", kind: "retry", due_at: "2026-11-03T06:30:00Z", status: "pending" }], appointments: [] }]);
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });

it("lists customers with the total and works before the filter values arrive", async () => {
  const slow = deferred<CustomerListFilterOptions>(); mocks.filters.mockReturnValue(slow.promise);
  render(<CustomerMasterPage onOpenCrm={() => undefined} />);
  expect(await screen.findByRole("button", { name: "Open Asha Jain" })).toBeTruthy();
  expect(screen.getByText("1–50 of 120")).toBeTruthy();
  expect(screen.getByText("Tried, never reached")).toBeTruthy();
  await act(async () => slow.resolve(options));
  expect(await screen.findByRole("option", { name: "Mumbai (80)" })).toBeTruthy();
});

it("keeps the list usable when the filter values fail to load", async () => {
  mocks.filters.mockRejectedValue(new Error("unavailable"));
  render(<CustomerMasterPage onOpenCrm={() => undefined} />);
  expect(await screen.findByRole("button", { name: "Open Asha Jain" })).toBeTruthy();
  expect(screen.queryByText("unavailable")).toBeNull();
});

it("sends a chosen filter and returns to the first page", async () => {
  render(<CustomerMasterPage onOpenCrm={() => undefined} />);
  await screen.findByRole("button", { name: "Open Asha Jain" });
  fireEvent.click(screen.getByRole("button", { name: /Next/ }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ city: "" }), 1));
  fireEvent.change(await screen.findByLabelText("City"), { target: { value: "Pune" } });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ city: "Pune" }), 0));
  fireEvent.click(screen.getByRole("button", { name: "Clear filters (1)" }));
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ city: "" }), 0));
});

it("waits for typing to pause before searching", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<CustomerMasterPage onOpenCrm={() => undefined} />);
  await screen.findByRole("button", { name: "Open Asha Jain" });
  const calls = mocks.list.mock.calls.length;
  fireEvent.change(screen.getByLabelText("Search customers"), { target: { value: "98" } });
  fireEvent.change(screen.getByLabelText("Search customers"), { target: { value: "9820" } });
  expect(mocks.list.mock.calls.length).toBe(calls);
  await act(async () => { vi.advanceTimersByTime(400); });
  await waitFor(() => expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ query: "9820" }), 0));
  expect(mocks.list.mock.calls.filter(([filters]) => (filters as { query: string }).query === "98").length).toBe(0);
});

it("drops an older response that arrives after a newer one", async () => {
  render(<CustomerMasterPage onOpenCrm={() => undefined} />);
  await screen.findByRole("button", { name: "Open Asha Jain" });
  const older = deferred<CustomerListPage>(); const newer = deferred<CustomerListPage>();
  mocks.list.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Pune" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Mumbai" } });
  await act(async () => newer.resolve(pageOf([row("Newer Result", "MKC-100003")])));
  await act(async () => older.resolve(pageOf([row("Older Result", "MKC-100002")])));
  expect(screen.getByRole("button", { name: "Open Newer Result" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Open Older Result" })).toBeNull();
});

it("opens a customer with profile and timeline", async () => {
  render(<CustomerMasterPage onOpenCrm={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open Asha Jain" }));
  expect(await screen.findByText("MKI-1000001")).toBeTruthy();
  expect(screen.getByText("Not contacted (Not picking)")).toBeTruthy();
  expect(screen.getByText(/Follow-up MKFU-100001: Retry/)).toBeTruthy();
  expect(await screen.findByText("Asha J")).toBeTruthy();
  expect(mocks.profile).toHaveBeenCalledWith("MKC-100001");
});

it("shows a failed list load with a retry", async () => {
  mocks.list.mockRejectedValueOnce(new Error("Section access denied"));
  render(<CustomerMasterPage onOpenCrm={() => undefined} />);
  expect(await screen.findByText("Section access denied")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("button", { name: "Open Asha Jain" })).toBeTruthy();
});
