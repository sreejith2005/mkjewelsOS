// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ActionMenu } from "./ActionMenu";

afterEach(cleanup);

it("opens, runs a choice, and closes on Escape with focus back on its button", () => {
  const pause = vi.fn();
  render(<ActionMenu items={[{ label: "Pause", onSelect: pause }, { label: "Delete", onSelect: vi.fn(), danger: true }]} label="More actions for Sales" />);
  const button = screen.getByRole("button", { name: "More actions for Sales" });
  fireEvent.click(button);
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Pause" }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Delete" }));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  fireEvent.click(screen.getByRole("menuitem", { name: "Pause" }));
  expect(pause).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("menu")).toBeNull();
});

it("renders nothing without actions", () => {
  render(<ActionMenu items={[]} label="More" />);
  expect(screen.queryByRole("button")).toBeNull();
});
