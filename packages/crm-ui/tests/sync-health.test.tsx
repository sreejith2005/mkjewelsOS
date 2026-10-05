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

  it("says so when it cannot load (for example, not a super admin)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    render(<SyncHealth />);
    await waitFor(() => expect(screen.getByText("Sync health could not be loaded.")).toBeTruthy());
  });
});
