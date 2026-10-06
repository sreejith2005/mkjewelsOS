// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
import { SyncHealth } from "@/components/sync-health";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("SyncHealth", () => {
  it("shows the counts from crm_sync_health", async () => {
    rpc.mockResolvedValue({ data: { active_grants: 12, staff_events_7d: { granted: 3 }, blocked_staff: { needs_link: 2 }, outbound_open: 1, outbound_failing: 0, outbound_dead: 0, walkin_ingest_7d: {} }, error: null });
    render(<SyncHealth />);
    await waitFor(() => expect(screen.getByText("12")).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith("crm_sync_health");
    expect(screen.getByText("NEEDS LINK: 2")).toBeTruthy();
    expect(screen.getByText("1 / 0 / 0")).toBeTruthy();
  });

  it("shows the Google Sheet sync block, counts only, and flags an overdue sync", async () => {
    rpc.mockResolvedValue({ data: { active_grants: 1, sheet: {
      last_finished_live_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      waiting_for_sheet: 4,
      conflicts_7d: { sheet_won: 2 },
      open_errors: { mkc_identity_conflict: 3 },
      last_push_by_tab: {},
      last_import: { mode: "dry_run", status: "finished", finished_at: null, counts: { push: { "CLIENT DATABASE MASTER": { inserted: 5, matched: 7 } }, crm_only: 9 } },
    } }, error: null });
    render(<SyncHealth />);
    await waitFor(() => expect(screen.getByText(/^OVERDUE — /)).toBeTruthy());
    expect(screen.getByText(/^OVERDUE — /).className).toContain("text-red-700");
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("SHEET WON: 2")).toBeTruthy();
    expect(screen.getByText("MKC IDENTITY CONFLICT: 3")).toBeTruthy();
    expect(screen.getByText("DRY RUN FINISHED NEVER | CLIENT DATABASE MASTER — INSERTED: 5 · MATCHED: 7 | CRM CLIENTS NOT IN THE SHEET: 9")).toBeTruthy();
  });

  it("says so when it cannot load (for example, not a super admin)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    render(<SyncHealth />);
    await waitFor(() => expect(screen.getByText("Sync health could not be loaded.")).toBeTruthy());
  });
});
