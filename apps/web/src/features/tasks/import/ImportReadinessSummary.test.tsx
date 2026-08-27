// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ImportReadinessSummary } from "./ImportReadinessSummary";

it("summarizes a large import without rendering one correction per row", () => {
  render(<ImportReadinessSummary assigned={1203} assigningLeft={729} recurring={1932} startDate="2026-08-27" total={1932} />);
  expect(screen.getAllByText("1,932")).toHaveLength(2);
  expect(screen.getByText("1,203")).toBeTruthy();
  expect(screen.getByText("729")).toBeTruthy();
  expect(screen.getByText("Assigning Left")).toBeTruthy();
  expect(screen.getByText(/27 Aug 2026/)).toBeTruthy();
});
