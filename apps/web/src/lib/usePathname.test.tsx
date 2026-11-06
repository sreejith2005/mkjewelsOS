// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { usePathname } from "./usePathname";
afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

it("keeps navigation stable across shell rerenders and query-only destinations", () => {
  const { result, rerender } = renderHook(usePathname);
  const navigate = result.current.navigate;
  rerender();
  expect(result.current.navigate).toBe(navigate);
  act(() => navigate("/tasks/fms?starter=first"));
  act(() => navigate("/tasks/fms?starter=second"));
  expect(result.current.path).toBe("/tasks/fms");
  expect(result.current.search).toBe("?starter=second");
  expect(result.current.navigate).toBe(navigate);
});

it("restores route and query on browser history events", () => {
  const { result } = renderHook(usePathname);
  act(() => { window.history.replaceState({}, "", "/crm/queue?branch=test"); window.dispatchEvent(new PopStateEvent("popstate")); });
  expect(result.current.path).toBe("/crm/queue");
  expect(result.current.search).toBe("?branch=test");
});
