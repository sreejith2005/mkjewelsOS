// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Donut, StackedBars } from "./charts";
afterEach(cleanup);

it("keeps a one-percent outcome readable and clickable in a concentrated distribution", () => {
  const onSelect = vi.fn();
  render(<Donut title="Completion" total={100} centerLabel="assigned" onSelect={onSelect} segments={[{ key: "completed", label: "Completed", value: 99 }, { key: "overdue", label: "Overdue", value: 1 }]} />);
  fireEvent.click(screen.getByRole("button", { name: /Overdue 1 1.0%/ }));
  expect(onSelect).toHaveBeenCalledWith("overdue");
});

it("opens a small comparison outcome from its printed count", () => {
  const onSelect = vi.fn();
  render(<StackedBars rows={[{ id: "person", label: "Employee", segments: [{ key: "completed", label: "Completed", value: 99 }, { key: "late", label: "Late", value: 1 }] }]} onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: /Late: 1.*1.0%/ }));
  expect(onSelect).toHaveBeenCalledWith("person", "late");
});

it("draws a reference donut even when one outcome occupies 99 percent", () => {
  const onSelect = vi.fn();
  render(<Donut title="Completed vs Pending" total={100} centerLabel="Total Task" variant="ring" onSelect={onSelect} segments={[{key:"completed",label:"Completed",value:1},{key:"remaining",label:"Pending",value:99}]} />);
  expect(screen.getByRole("img", {name:/Completed vs Pending/})).toBeTruthy();
  fireEvent.click(screen.getByRole("button", {name:"Completed: 1 (1.0%). Open records."}));
  expect(onSelect).toHaveBeenCalledWith("completed");
});
