// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { QuotaChip } from "./QuotaChip";

afterEach(cleanup);

describe("QuotaChip", () => {
  it("shows the questions left and the reset time", () => {
    render(<QuotaChip quota={{ used: 3, limit: 10, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" }} />);
    expect(screen.getByText(/7 of 10 questions left today/)).toBeTruthy();
    expect(screen.getByText(/resets 12:00 am on 10 Oct/)).toBeTruthy();
  });

  it("is hidden for people without a limit (Super Admin or an unlimited exception)", () => {
    const { container } = render(<QuotaChip quota={{ used: 40, limit: null, resets_at: "2026-10-09T18:30:00Z" }} />);
    expect(container.textContent).toBe("");
    expect(container.querySelector("span")).toBeNull();
  });

  it("stays visible for a lower personal limit, including when it is used up", () => {
    render(<QuotaChip quota={{ used: 2, limit: 2, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" }} />);
    expect(screen.getByText(/0 of 2 questions left today/)).toBeTruthy();
  });

  it("renders nothing before the quota loads", () => {
    const { container } = render(<QuotaChip quota={null} />);
    expect(container.textContent).toBe("");
  });
});
