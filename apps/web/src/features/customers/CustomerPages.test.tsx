// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerClientPage, CustomerInteractionPage, CustomerTimelineEntry } from "./api";

const mocks = vi.hoisted(() => ({ clientPage: vi.fn(), interactionPage: vi.fn(), timeline: vi.fn(), wide: true }));
vi.mock("./api", () => ({ loadCustomerClientPage: mocks.clientPage, loadCustomerInteractionPage: mocks.interactionPage, loadCustomerTimeline: mocks.timeline }));
vi.mock("@/lib/useMediaQuery", () => ({ useMediaQuery: () => mocks.wide }));

import { CustomerInteractionView } from "./CustomerInteractionView";
import { CustomerProfileView } from "./CustomerProfileView";

const answer = (field_key: string, label: string, value: string, is_current = true, has_column = true) =>
  ({ field_key, label, value, source: "runo", source_label: "Runo calling", observed_at: "2026-11-02T11:00:00Z", is_current, needs_review: false, has_column });
const client: CustomerClientPage = {
  client: { id: "c1", client_code: "MKC-100001", referral_code: "MKREF-100001", primary_name: "Asha Jain", city: "Mumbai", segment: "lead", lifecycle_stage: "engaged",
    first_seen_at: "2026-11-01T04:30:00Z", first_source: "runo", last_contacted_at: null, last_attempt_at: "2026-11-01T04:30:00Z", interaction_count: 2, successful_interaction_count: 1, do_not_call: false },
  family: { household_code: "MKF-100001", main_client_id: "c1", members: [{ client_id: "c1", client_code: "MKC-100001", name: "Asha Jain" }, { client_id: "c2", client_code: "MKC-100002", name: "Ayush Jain" }] },
  phones: [{ phone: "919820008001", kind: "primary" }, { phone: "919820008002", kind: "billing" }],
  names: [{ name: "Asha Jain", source: "runo", last_seen_at: "2026-11-02T11:00:00Z" }, { name: "Asha", source: "runo", last_seen_at: "2026-11-01T04:30:00Z" }],
  identifiers: [{ type: "runo_customer_id", value: "RUNO-77" }], referred_by: { client_id: "c9", client_code: "MKC-100009", name: "Kiran Rao" }, field_sources: {}, needs_review_count: 0,
  answers: [answer("city", "City", "Mumbai"), answer("city", "City", "Thane", false), answer("dob", "Date of birth", "--04-12"), answer("gift_given", "Gift Given", "Calendar", true, false)],
  follow_ups: [{ code: "MKFU-100002", kind: "hot", due_at: "2026-11-06T00:00:00Z", status: "pending", reason: null, assigned_to: "Priya Nair", origin_interaction_code: "MKI-1000002", closed_at: null, closed_by_interaction_code: null }],
  appointments: [{ code: "MKA-100001", type: "store", scheduled_at: "2026-11-08T11:30:00Z", status: "booked", branch: "MK Bandra", origin_interaction_code: "MKI-1000002", visit_interaction_code: null }],
  products: [{ code: "MK-NK-1015", category: "Necklace", interest: "interested", interaction_code: "MKI-1000002", occurred_at: "2026-11-02T11:00:00Z" }],
  sheet_rows: [{ source: "runo", label: "Runo live interactions", rows: 2 }], archived: false, archive_reason: null,
};
const entry: CustomerTimelineEntry = { interaction_id: "i2", interaction_code: "MKI-1000002", occurred_at: "2026-11-02T11:00:00Z", channel: "call", direction: "outbound", purpose: "other",
  outcome: "Invited to Store", result: "positive", successful: true, non_contact_reason: null, notes: "Wants a bridal set", source: "runo", staff: "Priya Nair", attended_by: "Rahul", branch: "MK Bandra",
  products: [], follow_ups: [{ code: "MKFU-100002", kind: "hot", due_at: "2026-11-06T00:00:00Z", status: "pending" }], appointments: [] };
const interaction: CustomerInteractionPage = {
  interaction: { interaction_id: "i2", interaction_code: "MKI-1000002", occurred_at: "2026-11-02T11:00:00Z", channel: "call", direction: "outbound", purpose: "other", outcome: "Invited to Store",
    result: "positive", successful: true, non_contact_reason: null, notes: "Wants a bridal set before December", source: "runo", source_label: "Runo calling", staff: "Priya Nair", staff_as_written: "Priya",
    assigned_by: null, attended_by: "Rahul", branch: "MK Bandra", store_as_written: "MK Bandra", contact_role: "Buyer", customer_type_stated: "New", process_name: null, fms_stage: null, external_ref: "p-2",
    created_at: "2026-11-02T11:05:00Z", updated_at: "2026-11-02T11:05:00Z", archived: false, archive_reason: null },
  client: { client_id: "c1", client_code: "MKC-100001", name: "Asha Jain", phone: "919820008001", city: "Mumbai" },
  products: [{ code: "MK-NK-1015", category: "Necklace", interest: "interested" }],
  follow_ups_created: [{ code: "MKFU-100002", kind: "hot", due_at: "2026-11-06T00:00:00Z", status: "pending", reason: null, assigned_to: "Priya Nair", closed_by_interaction_code: null }],
  follow_ups_closed: [{ code: "MKFU-100001", kind: "retry", due_at: "2026-11-02T04:30:00Z", origin_interaction_code: "MKI-1000001" }],
  appointments_created: [{ code: "MKA-100001", type: "store", scheduled_at: "2026-11-08T11:30:00Z", status: "booked", branch: "MK Bandra" }], appointments_completed: [],
  answers: [{ label: "City", value: "Mumbai" }],
  sheet_row: { source: "runo", label: "Runo live interactions", sheet_row: 3, status: "applied", first_seen_at: "2026-11-02T11:05:00Z", changed_at: "2026-11-02T11:05:00Z",
    columns: [{ header: "callId", value: "p-2", in_sheet: true }, { header: "Notes", value: "Wants a bridal set before December", in_sheet: true }, { header: "Email", value: null, in_sheet: true }, { header: "Old Column", value: "kept", in_sheet: false }] },
};
const handlers = () => ({ onBack: vi.fn(), onOpenClient: vi.fn(), onOpenInteraction: vi.fn() });

beforeEach(() => { mocks.wide = true; mocks.clientPage.mockResolvedValue(client); mocks.timeline.mockResolvedValue([entry]); mocks.interactionPage.mockResolvedValue(interaction); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("shows every detail of a customer on one page", async () => {
  render(<CustomerProfileView clientCode="MKC-100001" {...handlers()} />);
  expect(await screen.findByRole("heading", { name: "Asha Jain" })).toBeTruthy();
  expect(mocks.clientPage).toHaveBeenCalledWith("MKC-100001");
  expect(mocks.timeline).toHaveBeenCalledWith("c1");
  for (const text of ["MKF-100001", "MKREF-100001", "RUNO-77", "Runo live interactions: 2 rows", "12 April", "Calendar"]) expect(screen.getByText(text)).toBeTruthy();
  expect(screen.getByText(/Earlier: Thane \(Runo calling/)).toBeTruthy();
  expect(screen.getByText(/\+91 98200 08002 \(billing\)|98200 08002 \(billing\)/)).toBeTruthy();
  expect(screen.getByText("Other details")).toBeTruthy();
  expect(await screen.findByText("Wants a bridal set")).toBeTruthy();
  expect(screen.getByText(/Led to: Hot follow-up on/)).toBeTruthy();
});

it("opens an interaction, a family member and the referrer from the customer page", async () => {
  const on = handlers();
  render(<CustomerProfileView clientCode="MKC-100001" {...on} />);
  fireEvent.click(await screen.findByRole("button", { name: "Open interaction MKI-1000002" }));
  expect(on.onOpenInteraction).toHaveBeenCalledWith("MKI-1000002");
  fireEvent.click(screen.getByRole("button", { name: "MKC-100002" }));
  fireEvent.click(screen.getByRole("button", { name: "MKC-100009" }));
  expect(on.onOpenClient.mock.calls).toEqual([["MKC-100002"], ["MKC-100009"]]);
  fireEvent.click(screen.getByRole("button", { name: /All customers/ }));
  expect(on.onBack).toHaveBeenCalled();
});

it("uses three large tabs on a phone", async () => {
  mocks.wide = false;
  render(<CustomerProfileView clientCode="MKC-100001" {...handlers()} />);
  await screen.findByRole("heading", { name: "Asha Jain" });
  expect(screen.getByRole("tab", { name: "Details" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("button", { name: "Open interaction MKI-1000002" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
  expect(await screen.findByRole("button", { name: "Open interaction MKI-1000002" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Follow-ups (1)" }));
  expect(screen.getByText("Store appointment")).toBeTruthy();
});

it("loads older interactions on request", async () => {
  mocks.timeline.mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => ({ ...entry, interaction_id: `i${index}`, interaction_code: `MKI-10000${String(index).padStart(2, "0")}` })));
  mocks.timeline.mockResolvedValueOnce([{ ...entry, interaction_id: "old", interaction_code: "MKI-999" }]);
  render(<CustomerProfileView clientCode="MKC-100001" {...handlers()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Show older" }));
  expect(await screen.findByRole("button", { name: "Open interaction MKI-999" })).toBeTruthy();
  expect(mocks.timeline).toHaveBeenLastCalledWith("c1", "2026-11-02T11:00:00Z");
  expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
});

it("says so when a customer cannot be opened", async () => {
  mocks.clientPage.mockRejectedValue(new Error("Client not found"));
  render(<CustomerProfileView clientCode="MKC-1" {...handlers()} />);
  expect(await screen.findByText("Client not found")).toBeTruthy();
  expect(screen.getByRole("button", { name: /All customers/ })).toBeTruthy();
});

it("shows every detail of an interaction and its whole sheet row", async () => {
  const on = handlers();
  render(<CustomerInteractionView interactionCode="MKI-1000002" {...on} />);
  expect(await screen.findByRole("heading", { name: "Phone call with Asha Jain" })).toBeTruthy();
  expect(mocks.interactionPage).toHaveBeenCalledWith("MKI-1000002");
  const what = within(screen.getByText("What happened").closest("section") as HTMLElement);
  for (const text of ["Invited to Store", "Priya Nair", "Rahul", "MK Bandra", "Buyer", "We contacted the customer"]) expect(what.getByText(text)).toBeTruthy();
  expect(within(screen.getByText("Remark").closest("section") as HTMLElement).getByText("Wants a bridal set before December")).toBeTruthy();
  expect(screen.getByText(/Created: Hot follow-up, due/)).toBeTruthy();
  expect(screen.getByText(/Closed: Try again that was due/)).toBeTruthy();
  expect(screen.getByText(/Booked: Store appointment/)).toBeTruthy();
  const sheet = within(screen.getByText("Sheet row").closest("section") as HTMLElement);
  expect(sheet.getByText(/Runo live interactions, row 3/)).toBeTruthy();
  expect(sheet.getByText("callId")).toBeTruthy();
  expect(sheet.getByText("Old Column (no longer in the sheet)")).toBeTruthy();
  expect(sheet.queryByText("Email")).toBeNull();
  fireEvent.click(sheet.getByRole("button", { name: "Show 1 empty columns" }));
  expect(sheet.getByText("Email")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "MKI-1000001" }));
  expect(on.onOpenInteraction).toHaveBeenCalledWith("MKI-1000001");
  fireEvent.click(screen.getByRole("button", { name: "Open customer" }));
  expect(on.onOpenClient).toHaveBeenCalledWith("MKC-100001");
});
