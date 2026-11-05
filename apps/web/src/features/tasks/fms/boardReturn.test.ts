// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { rememberFmsBoardReturn, fmsTasksReturnPath, returnFromFmsWork } from "./boardReturn";
import { readTaskViewState, saveTaskViewState } from "../taskViewState";
import { defaultTaskSearch } from "@jewelos/core";
afterEach(() => { sessionStorage.clear(); window.history.replaceState({}, "", "/"); });
it.each(["/tasks", "/tasks?view=fms", "/tasks?view=fms&workflow=family&status=waiting", "/home", "/notifications"])("returns to the source %s with its task view settings", path => {
  window.history.replaceState({}, "", path);
  const state = { actorId: "actor", view: "delegated" as const, calendarScope: "overall" as const, status: "overdue" as const, offset: 50, filters: { ...defaultTaskSearch(), query: "ring" } };
  saveTaskViewState(state);
  const work = "/tasks/fms?starter=assignment&form=template";
  rememberFmsBoardReturn(path, work);
  window.history.pushState({}, "", work);
  const navigate = vi.fn((next: string) => window.history.pushState({}, "", next));
  returnFromFmsWork(navigate);
  expect(navigate).toHaveBeenCalledWith(path);
  expect(readTaskViewState("actor")).toEqual(state);
  expect(readTaskViewState("another-actor")).toBeNull();
});
it.each(["https://example.com/tasks", "//example.com/tasks", "/tasks/fms?starter=other"])("rejects unsafe or recursive return destinations %s", path => {
  rememberFmsBoardReturn(path, "/tasks/fms?starter=assignment");
  expect(fmsTasksReturnPath("/tasks/fms?starter=assignment")).toBe("/tasks?view=fms");
});
