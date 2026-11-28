// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ overview: vi.fn(), queue: vi.fn(), decide: vi.fn(), rules: vi.fn(), values: vi.fn() }));
vi.mock("./api", () => ({
  loadCustomerStdOverview: mocks.overview, loadCustomerStdQueue: mocks.queue, decideCustomerStd: mocks.decide, loadCustomerStdRules: mocks.rules,
  loadCustomerRefValues: mocks.values, endCustomerStdRule: vi.fn(), reviewCustomerStdDraft: vi.fn(), saveCustomerRefValue: vi.fn(),
  setCustomerStdPolicy: vi.fn(), reprocessCustomerStd: vi.fn(),
}));

import { CustomerStandardsView } from "./CustomerStandardsView";

const can = { suggest: true, approve: true, high_impact: true, reference: true, policies: true, reprocess: true, rollback: true };
beforeEach(() => {
  mocks.overview.mockResolvedValue({
    fields: [{ key: "city", label: "City", policy: "place", domain: "place", multi: false, sensitive: false, output_field: "city", meaning: null,
      observations: 120, customers: 100, statuses: { standardized: 100, unmapped: 20 }, values: 300 }],
    jobs: [], can,
  });
  mocks.queue.mockResolvedValue({ field: "city", label: "City", domain: "place", policy: "place", total: 1, items: [{
    input_key: "bombay central", examples: ["BOMBAY CENTRAL", "Bombay Central"], observations: 14, customers: 12, status: "unmapped", sources: ["Centralized database"],
    rule: null, candidates: [], suggestions: [{ code: "place:mumbai-mumbai-central", label: "Mumbai Central", kind: "locality", parent: "Mumbai" }],
  }] });
  mocks.decide.mockResolvedValue({ rule_id: "r1", status: "approved", customers: 12 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("lists values to review and applies a suggestion to every customer with that value", async () => {
  render(<CustomerStandardsView onBack={vi.fn()} />);
  const item = await screen.findByRole("article", { name: "BOMBAY CENTRAL" });
  expect(within(item).getByText("12 customers · 14 answers")).toBeTruthy();
  fireEvent.click(within(item).getByRole("button", { name: "Mumbai Central, Mumbai (locality)" }));
  expect(await screen.findByText('"BOMBAY CENTRAL": now Mumbai Central, 12 customers updating.')).toBeTruthy();
  expect(mocks.decide).toHaveBeenCalledWith("city", "bombay central", { map: "place:mumbai-mumbai-central" }, null);
});

it("marks a value as not recorded", async () => {
  render(<CustomerStandardsView onBack={vi.fn()} />);
  const item = await screen.findByRole("article", { name: "BOMBAY CENTRAL" });
  fireEvent.click(within(item).getByRole("button", { name: "Not recorded" }));
  expect(mocks.decide).toHaveBeenCalledWith("city", "bombay central", { status: "missing" }, null);
});
