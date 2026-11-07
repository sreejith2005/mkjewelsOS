// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSiAnalytics, type SiAnalytics } from "@jewelos/core/salesScore/analytics";
import { fetchSiAnalytics, fetchSiOptions, fetchSiSessions } from "@jewelos/data/recordingAnalytics";
import { InsightsView } from "./InsightsView";
import { createLatestGate, useRevisionQuery } from "./useRevisionQuery";

vi.mock("@jewelos/data", () => {
  class WorkspaceError extends Error { kind = "unavailable"; }
  return { WorkspaceError };
});
vi.mock("@jewelos/data/recordingAnalytics", () => {
  class SupersededError extends Error {}
  return { SupersededError, fetchSiAnalytics: vi.fn(), fetchSiOptions: vi.fn(), fetchSiSessions: vi.fn(), fetchSiDeviceDays: vi.fn() };
});

const B1 = "11111111-1111-4111-8111-111111111111";
function summary(over: Record<string, unknown> = {}): SiAnalytics {
  return parseSiAnalytics({
    meta: { from: "2026-10-01", to: "2026-10-05", prior_from: "2026-09-26", prior_to: "2026-09-30", generated_at: "2026-10-05T06:00:00Z", min_sample: 5,
      branches: [{ id: B1, name: "Main store" }], freshness: { analysis_enabled: true, analysis_waiting: 1 } },
    current: { sessions: 8, scored: 3, average_score: 71, analysed: 4, with_audio: 8, average_duration_ms: 240000, crm: { eligible: 0, confirmed: 0, not_linked: 8 }, outcomes: {}, funnel: {} },
    prior: { sessions: 4 }, by_day: [{ date: "2026-10-02", sessions: 8, scored: 3, average_score: 71 }], ...over,
  });
}
const navigate = vi.fn();
beforeEach(() => {
  vi.mocked(fetchSiOptions).mockResolvedValue({ all_branches: false, home_branch_id: B1, branches: [{ id: B1, name: "Main store" }], employees: [], devices: [] });
  vi.mocked(fetchSiSessions).mockResolvedValue({ rows: [], has_more: false, total: 8 });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("latest request wins", () => {
  it("a newer request aborts and outranks the older one", () => {
    const gate = createLatestGate();
    const first = gate.begin(); const second = gate.begin();
    expect(first.signal.aborted).toBe(true);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
    gate.cancel();
    expect(second.isCurrent()).toBe(false);
  });
  it("a slow old response never overwrites the current filters' result", async () => {
    const pending = new Map<string, (value: string) => void>();
    function Probe({ k }: { k: string }) {
      const state = useRevisionQuery(k, () => new Promise<string>((resolve) => pending.set(k, resolve)));
      return <p>{state.data ?? "none"}</p>;
    }
    const { rerender } = render(<Probe k="old" />);
    rerender(<Probe k="new" />);
    await act(async () => { pending.get("new")!("new result"); });
    await act(async () => { pending.get("old")!("old result"); });
    expect(screen.getByText("new result")).toBeTruthy();
    expect(screen.queryByText("old result")).toBeNull();
  });
});

describe("Insights dashboard", () => {
  it("fetches the summary once per filter revision, not per view", async () => {
    vi.mocked(fetchSiAnalytics).mockResolvedValue(summary());
    const { rerender } = render(<InsightsView navigate={navigate} search="period=custom&from=2026-10-01&to=2026-10-05" view="overview" />);
    await screen.findByText("Average score per day (0–100; gaps = nothing scored)");
    rerender(<InsightsView navigate={navigate} search="period=custom&from=2026-10-01&to=2026-10-05" view="conversations" />);
    await screen.findByText("Top associate");
    expect(fetchSiAnalytics).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchSiAnalytics).mock.calls[0]![0]).toEqual({ from: "2026-10-01", to: "2026-10-05" });
    rerender(<InsightsView navigate={navigate} search="period=custom&from=2026-10-01&to=2026-10-05&cat=ring" view="conversations" />);
    await waitFor(() => expect(fetchSiAnalytics).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetchSiAnalytics).mock.calls[1]![0]).toEqual({ from: "2026-10-01", to: "2026-10-05", category: "ring" });
  });
  it("shows sample sizes, says too few and no data instead of zero, and reports what is still processing", async () => {
    vi.mocked(fetchSiAnalytics).mockResolvedValue(summary());
    render(<InsightsView navigate={navigate} search="period=custom&from=2026-10-01&to=2026-10-05" view="overview" />);
    expect(await screen.findByText("N = 3 scored of 8")).toBeTruthy();
    expect(screen.getByText("71*")).toBeTruthy();
    expect(screen.getByText(/too few to compare/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /No data ?: show the conversations behind Confirmed conversion/ })).toBeTruthy();
    expect(screen.getByText(/1 waiting for AI review/)).toBeTruthy();
    expect(screen.getByText(/Up 100% vs prior period/)).toBeTruthy();
  });
  it("explains each figure and opens the conversations behind it", async () => {
    vi.mocked(fetchSiAnalytics).mockResolvedValue(summary());
    render(<InsightsView navigate={navigate} search="period=custom&from=2026-10-01&to=2026-10-05" view="overview" />);
    fireEvent.click(await screen.findByRole("button", { name: "How Average score is counted" }));
    expect(screen.getByText(/Unscored and expired ones are left out, not counted as 0/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /show the conversations behind Conversations/ }));
    const dialog = await screen.findByRole("dialog", { name: "Conversations" });
    await waitFor(() => expect(within(dialog).getByText(/8 conversations/)).toBeTruthy());
    expect(fetchSiSessions).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-10-05" }, "sessions", undefined, expect.any(AbortSignal));
  });
  it("puts filter changes in the URL", async () => {
    vi.mocked(fetchSiAnalytics).mockResolvedValue(summary());
    render(<InsightsView navigate={navigate} search="" view="overview" />);
    fireEvent.click(screen.getByRole("radio", { name: "This week" }));
    expect(navigate).toHaveBeenCalledWith(expect.stringMatching(/^\/sales-recording\/insights\?view=overview&period=week$/));
  });
  it("ranks only people with enough conversations", async () => {
    vi.mocked(fetchSiAnalytics).mockResolvedValue(summary({ by_employee: [
      { employee_id: "e1", employee_name: "Asha", sessions: 9, scored: 6, average_score: 80, eligible: 6, confirmed: 3 },
      { employee_id: "e2", employee_name: "Ravi", sessions: 3, scored: 2, average_score: 95, eligible: 2, confirmed: 2 },
    ] }));
    render(<InsightsView navigate={navigate} search="" view="rankings" />);
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Asha" })).toBeTruthy();
    expect(within(table).queryByText("Ravi")).toBeNull();
    expect(screen.getByText(/Not ranked \(1\): Ravi/)).toBeTruthy();
  });
});
