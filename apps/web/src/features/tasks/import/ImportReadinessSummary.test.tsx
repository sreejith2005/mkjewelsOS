// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ImportReadinessSummary } from "./ImportReadinessSummary";

it("summarizes a large import without rendering one correction per row", () => {
  render(<ImportReadinessSummary assigned={1061} assigningLeft={871} blocked={68} ready={1932} recurring={1932} startDate="2026-08-27" total={2000} unresolvedLabels={6} unresolvedNamed={142} />);
  expect(screen.getByText("Source records")).toBeTruthy();
  expect(screen.getByText("2,000")).toBeTruthy();
  expect(screen.getByText("Ready to import")).toBeTruthy();
  expect(screen.getByText("1,932")).toBeTruthy();
  expect(screen.getByText("Blocked rows")).toBeTruthy();
  expect(screen.getByText("68")).toBeTruthy();
  expect(screen.getByText("1,061")).toBeTruthy();
  expect(screen.getByText("871")).toBeTruthy();
  expect(screen.getByText("Assigning Left")).toBeTruthy();
  expect(screen.getByText(/142 rows across 6 written names need one confirmation/)).toBeTruthy();
  expect(screen.getByText(/729 rows have no employee name/)).toBeTruthy();
  expect(screen.getByText(/27 Aug 2026/)).toBeTruthy();
});
