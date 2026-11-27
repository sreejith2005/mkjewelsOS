// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SheetReadProblems } from "./SheetReadProblems";

afterEach(cleanup);
const now = Date.parse("2026-11-27T12:00:00Z");

it("names the failing sheet, the problem, the fix and the times", () => {
  render(<SheetReadProblems now={now} items={[
    { source: "ahd_contact_list", label: "AHEMDABAD list", scheduled: true, last_run_at: "2026-11-27T11:55:00Z", rows_received: 10, failed: true,
      error: "sheet_tab_not_found:AHEMDABAD list", error_since: "2026-11-27T09:00:00Z", last_ok_at: "2026-11-27T08:55:00Z" },
    { source: "walkin", label: "Walk-in", scheduled: true, last_run_at: "2026-11-27T11:58:00Z", rows_received: 5, failed: false },
  ]} />);
  expect(screen.getByText(/1 sheet needs attention/)).toBeTruthy();
  expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(false);
  expect(screen.getByText("AHEMDABAD list")).toBeTruthy();
  expect(screen.getByText(/tab "AHEMDABAD list" is not in the Google Sheet/)).toBeTruthy();
  expect(screen.getByText(/Failing since/)).toBeTruthy();
  expect(screen.getByText(/Last good read/)).toBeTruthy();
  expect(screen.queryByText("Walk-in")).toBeNull();
});

it("warns about a scheduled sheet not read for over 2 hours", () => {
  render(<SheetReadProblems now={now} items={[{ source: "master_sheet", label: "MASTER DATABASE", scheduled: true, last_run_at: "2026-11-27T08:00:00Z", rows_received: 1, failed: false }]} />);
  expect(screen.getByText(/1 sheet needs attention/)).toBeTruthy();
  expect(screen.getByText(/Not read since/)).toBeTruthy();
  expect(screen.getByText("MASTER DATABASE")).toBeTruthy();
});

it("shows nothing when every sheet is fine", () => {
  const { container } = render(<SheetReadProblems now={now} items={[{ source: "a", scheduled: true, last_run_at: "2026-11-27T11:59:00Z", rows_received: 1, failed: false }]} />);
  expect(container.textContent).toBe("");
});
