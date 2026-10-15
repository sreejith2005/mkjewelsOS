// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), tenant: vi.fn(), inbox: vi.fn() }));
vi.mock("@jewelos/data/sidebar/api", () => ({ loadMySidebarCounts: mocks.load }));
vi.mock("@/features/realtime/api", () => ({ subscribeToTenantRealtime: mocks.tenant }));
vi.mock("@/features/notifications/api", () => ({ subscribeToInbox: mocks.inbox }));
import { useSidebarCounts } from "./useSidebarCounts";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("live personal sidebar counts", () => {
  it("refreshes exact counts on durable work, inbox read, and focus changes", async () => {
    let tenantRefresh: () => void = () => {};
    let inboxRefresh: () => void = () => {};
    const stopTenant = vi.fn(); const stopInbox = vi.fn();
    mocks.tenant.mockImplementation((_id, topics, refresh) => { expect(topics).toEqual(["tasks", "fms", "forms", "organization", "settings"]); tenantRefresh = refresh; return stopTenant; });
    mocks.inbox.mockImplementation((_id, refresh) => { inboxRefresh = refresh; return stopInbox; });
    mocks.load.mockResolvedValue({ checklist_tasks: 1203, notifications: 701 });
    const { result, unmount } = renderHook(() => useSidebarCounts("profile", "tenant"));
    await waitFor(() => expect(result.current.checklist_tasks).toBe(1203));
    mocks.load.mockResolvedValue({ checklist_tasks: 1202, notifications: 701 });
    act(() => tenantRefresh());
    await waitFor(() => expect(result.current.checklist_tasks).toBe(1202));
    mocks.load.mockResolvedValue({ checklist_tasks: 1202, notifications: 0 });
    act(() => inboxRefresh());
    await waitFor(() => expect(result.current.notifications).toBe(0));
    mocks.load.mockResolvedValue({ checklist_tasks: 1201 });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.checklist_tasks).toBe(1201));
    unmount(); expect(stopTenant).toHaveBeenCalledOnce(); expect(stopInbox).toHaveBeenCalledOnce();
  });
  it("hides prior-account counts immediately while the next identity loads", async () => {
    mocks.tenant.mockReturnValue(() => {}); mocks.inbox.mockReturnValue(() => {});
    mocks.load.mockResolvedValueOnce({ checklist_tasks: 10 }).mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ id }) => useSidebarCounts(id, "tenant"), { initialProps: { id: "first" } });
    await waitFor(() => expect(result.current.checklist_tasks).toBe(10));
    rerender({ id: "second" });
    expect(result.current).toEqual({});
  });
});
