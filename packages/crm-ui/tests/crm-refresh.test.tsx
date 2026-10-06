// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCrmRefresh } from "@/crm-port/use-crm-refresh";

function Probe({ refresh }: { refresh: () => Promise<void> }) {
  useCrmRefresh(refresh);
  return <input aria-label="Unsaved client name" defaultValue="Draft" />;
}
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(navigator, "onLine", "get").mockReturnValue(true); vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("catches up on focus, visibility and reconnect, deferring offline or hidden observers", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<Probe refresh={refresh} />);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  act(() => window.dispatchEvent(new Event("focus")));
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(refresh).not.toHaveBeenCalled();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(refresh).toHaveBeenCalledTimes(2);
});

it("waits for actual loader completion before one follow-up and keeps the latest callback", async () => {
  let finish: (() => void) | undefined;
  const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
  const view = render(<Probe refresh={refresh} />);
  act(() => window.dispatchEvent(new Event("focus")));
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  const next = vi.fn().mockResolvedValue(undefined);
  view.rerender(<Probe refresh={next} />);
  act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
  expect(next).not.toHaveBeenCalled();
  await act(async () => { finish?.(); await vi.advanceTimersByTimeAsync(350); });
  expect(next).toHaveBeenCalledTimes(1);
});

it("refreshes active observers periodically and removes listeners and timers on unmount", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const view = render(<Probe refresh={refresh} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_350); });
  expect(refresh).toHaveBeenCalledTimes(1);
  view.unmount();
  act(() => window.dispatchEvent(new Event("online")));
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(refresh).toHaveBeenCalledTimes(1);
});
