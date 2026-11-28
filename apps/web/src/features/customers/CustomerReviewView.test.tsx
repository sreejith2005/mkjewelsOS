// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CustomerReviewItem, CustomerReviewSide } from "./api";

const mocks = vi.hoisted(() => ({ list: vi.fn(), decide: vi.fn(), queue: vi.fn() }));
vi.mock("./api", () => ({ loadCustomerReviewList: mocks.list, decideCustomerReview: mocks.decide, loadCustomerReviewQueue: mocks.queue }));

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

it("same name, different numbers: merge or keep separate (migration 0453)", async () => {
  mocks.queue.mockResolvedValue({ total: 1, items: [{ id: "q1", kind: "same_name", note: null, created_at: "2026-11-28T06:00:00Z", other_name: null, other_name_rows: null,
    a: side("MKC-100030", "Meera Kapoor", "919820053001"), b: side("MKC-100031", "Meera Kapoor", "919820053002") }] });
  mocks.decide.mockResolvedValue({ result: "merged", client_code: "MKC-100030" });
  render(<CustomerReviewView {...handlers()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Same name, different numbers" }));
  const pair = await screen.findByRole("article", { name: "MKC-100030 and MKC-100031" });
  expect(mocks.queue).toHaveBeenCalledWith("same_name");
  expect(screen.getByText("1 to decide")).toBeTruthy();
  fireEvent.click(within(pair).getByRole("button", { name: "Merge" }));
  expect(await screen.findByText("MKC-100030 and MKC-100031: Merged into one customer.")).toBeTruthy();
  expect(mocks.decide).toHaveBeenCalledWith("q1", true);
});

it("one number, different names: split the other name off", async () => {
  mocks.queue.mockResolvedValue({ total: 1, items: [{ id: "q2", kind: "shared_phone", note: null, created_at: "2026-11-28T06:00:00Z", other_name: "Kiran Mehta", other_name_rows: 2,
    a: side("MKC-100040", "Asha Mehta", "919820053003"), b: null }] });
  mocks.decide.mockResolvedValue({ result: "split", client_code: "MKC-100041" });
  render(<CustomerReviewView {...handlers()} />);
  fireEvent.click(screen.getByRole("tab", { name: "One number, different names" }));
  const item = await screen.findByRole("article", { name: "MKC-100040 and Kiran Mehta" });
  expect(within(item).getByText(/Written on 2 sheet rows/)).toBeTruthy();
  fireEvent.click(within(item).getByRole("button", { name: "Different people (split off)" }));
  expect(await screen.findByText("MKC-100040 and Kiran Mehta: Split off as its own customer in the same family.")).toBeTruthy();
  expect(mocks.decide).toHaveBeenCalledWith("q2", false);
});
