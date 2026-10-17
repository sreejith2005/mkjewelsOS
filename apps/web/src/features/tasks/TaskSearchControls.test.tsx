// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultTaskSearch } from "@jewelos/core";
import { TaskSearchControls } from "./TaskSearchControls";
afterEach(cleanup);
it("keeps advanced controls collapsed and applies selected filters together", () => {
  const changed = vi.fn();
  render(<TaskSearchControls value={defaultTaskSearch()} onChange={changed} canViewAll={false} />);
  expect(screen.getByRole("searchbox", { name: "Search all tasks" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Filter tasks" }));
  expect(screen.queryByRole("option", { name: "All Tasks" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Work kind"), { target: { value: "fms" } });
  fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
  expect(changed).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(changed).toHaveBeenCalledWith(expect.objectContaining({ kind: "fms", priority: "high" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("clears every search and filter with one action", () => {
  const changed = vi.fn();
  render(<TaskSearchControls value={{ ...defaultTaskSearch(), query: "silver", kind: "crm" }} onChange={changed} canViewAll={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
  expect(changed).toHaveBeenCalledWith(defaultTaskSearch());
});
