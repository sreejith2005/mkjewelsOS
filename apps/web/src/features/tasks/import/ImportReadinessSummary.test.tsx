// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ImportReadinessSummary } from "./ImportReadinessSummary";

it("summarizes a large import without rendering one correction per row", () => {
  render(<ImportReadinessSummary assigned={1061} assigningLeft={871} named={1203} recurring={1932} startDate="2026-08-27" total={1932} unresolvedLabels={6} unresolvedNamed={142} />);
  expect(screen.getByText("Names written")).toBeTruthy();
  expect(screen.getByText("1,203")).toBeTruthy();
  expect(screen.getByText("1,061")).toBeTruthy();
  expect(screen.getByText("871")).toBeTruthy();
  expect(screen.getByText("Assigning Left")).toBeTruthy();
  expect(screen.getByText(/142 rows across 6 written names need one confirmation/)).toBeTruthy();
  expect(screen.getByText(/729 rows have no employee name/)).toBeTruthy();
  expect(screen.getByText(/27 Aug 2026/)).toBeTruthy();
});
