// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerReviewItem, CustomerReviewSide } from "./api";

const mocks = vi.hoisted(() => ({ list: vi.fn(), decide: vi.fn() }));
vi.mock("./api", () => ({ loadCustomerReviewList: mocks.list, decideCustomerReview: mocks.decide }));

import { CustomerReviewView } from "./CustomerReviewView";

const side = (code: string, name: string, phone: string, extra: Partial<CustomerReviewSide> = {}): CustomerReviewSide => ({
  client_code: code, name, other_names: [], phones: [phone], franchise: "Mumbai", segment: "lead", city: "Mumbai", first_source: "Runo calling",
  first_origin: null, first_seen_at: "2026-01-04T05:00:00Z", last_contacted_at: null, interaction_count: 2, sheet_rows: 3, ...extra,
});
const joined: CustomerReviewItem = {
  id: "r1", kind: "joined", note: "joined automatically on a shared other name", created_at: "2026-11-20T06:00:00Z",
  a: side("MKC-100010", "Vikram Rao", "919820038001", { other_names: ["Asha Rao"] }), b: side("MKC-100011", "Asha Rao", "919820038002"), linking_rows: null,
};
const possible: CustomerReviewItem = {
  id: "r2", kind: "possible", note: null, created_at: "2026-11-20T06:00:00Z",
  a: side("MKC-100020", "Mohan Das", "919820038003"), b: side("MKC-100021", "Mohan Das", "919820038004"),
  linking_rows: [{ source: "Account list", sheet_row: 7 }],
};
const handlers = () => ({ onBack: vi.fn(), onOpenClient: vi.fn() });

beforeEach(() => { mocks.list.mockResolvedValue([joined, possible]); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("lists joins first, then flags, each with both records side by side", async () => {
  render(<CustomerReviewView {...handlers()} />);
  expect(await screen.findByText("Joined automatically (1)")).toBeTruthy();
  expect(screen.getByText("To decide (1)")).toBeTruthy();
  const pair = screen.getByRole("article", { name: "MKC-100020 and MKC-100021" });
  expect(within(pair).getAllByText("Mohan Das")).toHaveLength(2);
  expect(within(pair).getByText("Linked by 1 sheet row: Account list row 7")).toBeTruthy();
  expect(within(screen.getByRole("article", { name: "MKC-100010 and MKC-100011" })).getByText("Joined into it")).toBeTruthy();
});

it("same person merges; the pair leaves the list with the result shown", async () => {
  mocks.decide.mockResolvedValue({ result: "merged", client_code: "MKC-100020" });
  render(<CustomerReviewView {...handlers()} />);
  const pair = await screen.findByRole("article", { name: "MKC-100020 and MKC-100021" });
  fireEvent.click(within(pair).getByRole("button", { name: "Same person" }));
  expect(await screen.findByText("MKC-100020 and MKC-100021: Merged into one customer.")).toBeTruthy();
  expect(mocks.decide).toHaveBeenCalledWith("r2", true);
  expect(screen.queryByRole("article", { name: "MKC-100020 and MKC-100021" })).toBeNull();
});

it("different people separates a join", async () => {
  mocks.decide.mockResolvedValue({ result: "separated", client_code: "MKC-100010" });
  render(<CustomerReviewView {...handlers()} />);
  const pair = await screen.findByRole("article", { name: "MKC-100010 and MKC-100011" });
  fireEvent.click(within(pair).getByRole("button", { name: "Different people" }));
  expect(await screen.findByText("MKC-100010 and MKC-100011: Separated into two customers.")).toBeTruthy();
  expect(mocks.decide).toHaveBeenCalledWith("r1", false);
});

it("shows the server's refusal", async () => {
  mocks.list.mockRejectedValue(new Error("Section access denied"));
  render(<CustomerReviewView {...handlers()} />);
  expect(await screen.findByText("Section access denied")).toBeTruthy();
});
