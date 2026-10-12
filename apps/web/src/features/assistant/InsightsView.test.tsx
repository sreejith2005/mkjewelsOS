// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KiaraInsightsView } from "@jewelos/data/assistant/insights";
import { InsightsView } from "./InsightsView";

afterEach(cleanup);

const view = (overrides: Partial<KiaraInsightsView> = {}): KiaraInsightsView => ({
  rows: [
    { user_profile_id: "u1", name: "Asha Rao", designation: "Sales Executive", department: "Sales", branch: "Andheri", status: "rated", rating: 2, classification: "fresher",
      summary: "Mostly asks about leave and billing.", question_count: 14, sop_question_count: 10, active_days: 5, basic_count: 6, repeat_count: 2, escalated_count: 1,
      last_active_on: "2026-10-11", top_topics: ["Leave policy"], top_documents: ["Leave SOP"], top_departments: ["Sales"], computed_at: "2026-10-12T21:00:00Z" },
    { user_profile_id: "u2", name: "Ravi K", designation: null, department: "Drivers", branch: "Thane", status: "insufficient_data", rating: null, classification: null,
      summary: null, question_count: 3, sop_question_count: 2, active_days: 1, basic_count: 0, repeat_count: 0, escalated_count: 0,
      last_active_on: "2026-10-10", top_topics: [], top_documents: [], top_departments: [], computed_at: null },
  ],
  branches: [{ id: "b1", name: "Andheri" }],
  departments: [{ id: "d1", name: "Sales" }],
  scope: "tenant",
  windowDays: 60,
  minSopQuestions: 8,
  minActiveDays: 4,
  lastComputedAt: "2026-10-12T21:00:00Z",
  refresh: { allowed: false, requestedAt: null, nextAllowedAt: null },
  ...overrides,
});

describe("InsightsView", () => {
  it("shows the rating, class, counts, and the minimum for people without enough questions", async () => {
    render(<InsightsView load={vi.fn().mockResolvedValue(view())} />);
    expect(await screen.findByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText("Fresher", { selector: "span" })).toBeTruthy();
    expect(screen.getByLabelText("SOP knowledge 2 out of 5")).toBeTruthy();
    expect(screen.getByText("Not enough questions yet", { selector: "span" })).toBeTruthy();
    expect(screen.getByText(/at least 8 SOP questions on 4 different days/)).toBeTruthy();
    expect(screen.getByText(/not a performance appraisal/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Refresh insights now/ })).toBeNull();
  });

  it("filters through the database and lets Super Admin refresh once an hour", async () => {
    const load = vi.fn().mockResolvedValue(view({ refresh: { allowed: true, requestedAt: null, nextAllowedAt: null } }));
    const refresh = vi.fn().mockResolvedValue({ nextAllowedAt: "2099-01-01T00:00:00Z" });
    render(<InsightsView load={load} refresh={refresh} />);
    fireEvent.change(await screen.findByLabelText("Class"), { target: { value: "insufficient_data" } });
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ sort: "rating", classification: "insufficient_data" }));
    fireEvent.click(screen.getByRole("button", { name: /Refresh insights now/ }));
    expect(await screen.findByText(/Refresh started/)).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("disables the refresh button until the hour is over", async () => {
    render(<InsightsView load={vi.fn().mockResolvedValue(view({ refresh: { allowed: true, requestedAt: "2099-01-01T00:00:00Z", nextAllowedAt: "2099-01-01T01:00:00Z" } }))} />);
    const button = await screen.findByRole("button", { name: /Refresh insights now/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
