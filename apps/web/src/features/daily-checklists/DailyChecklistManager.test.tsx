// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DailyChecklistManager } from "./DailyChecklistManager";

describe("DailyChecklistManager", () => {
  it("does not expose checklist management to staff", () => {
    render(<DailyChecklistManager role="staff" />);
    expect(screen.queryByRole("heading", { name: "Daily checklists" })).toBeNull();
  });
});
