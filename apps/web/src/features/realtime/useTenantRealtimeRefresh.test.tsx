// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTenantRealtimeRefresh } from "./useTenantRealtimeRefresh";

const subscription = vi.hoisted(() => ({ subscribe: vi.fn() }));
vi.mock("./api", () => ({ subscribeToTenantRealtime: subscription.subscribe }));

function Probe({ refresh }: { refresh: () => Promise<void> }) {
  useTenantRealtimeRefresh({ tenantId: "tenant-1", topics: ["tasks"], refresh, debounceMs: 5 });
  return null;
}

afterEach(() => {
  vi.useRealTimers();
  subscription.subscribe.mockReset();
});

describe("useTenantRealtimeRefresh", () => {
  it("coalesces matching signals into one refresh and cancels its timer on unmount", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValue(undefined);
    let listener: (() => void) | undefined;
    subscription.subscribe.mockImplementation((_tenantId: string, _topics: string[], next: () => void) => {
      listener = next;
      return vi.fn();
    });
    const view = render(<Probe refresh={refresh} />);

    act(() => { listener?.(); listener?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => { listener?.(); view.unmount(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("waits for an active refresh before applying a burst as one follow-up refresh", async () => {
    vi.useFakeTimers();
    let resolveFirstRefresh: (() => void) | undefined;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { resolveFirstRefresh = resolve; })).mockResolvedValue(undefined);
    let listener: (() => void) | undefined;
    subscription.subscribe.mockImplementation((_tenantId: string, _topics: string[], next: () => void) => {
      listener = next;
      return vi.fn();
    });
    render(<Probe refresh={refresh} />);

    act(() => { listener?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => { listener?.(); listener?.(); listener?.(); listener?.(); listener?.(); listener?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => { resolveFirstRefresh?.(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(5); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
