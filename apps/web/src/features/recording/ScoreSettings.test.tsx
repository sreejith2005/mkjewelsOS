// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MK_SALES_RUBRIC_V1 } from "@jewelos/core";
import { configureAnalysis, createSopVersion, fetchAnalysisSettings, fetchScoreVersions, setSopStatus } from "@jewelos/data";
import { ScoreSettings } from "./ScoreSettings";

vi.mock("@jewelos/data", () => {
  class AnalysisActionError extends Error {}
  return { AnalysisActionError, fetchAnalysisSettings: vi.fn(), fetchScoreVersions: vi.fn(), configureAnalysis: vi.fn(), createSopVersion: vi.fn(), setSopStatus: vi.fn(), createRubricVersion: vi.fn(), activateRubricVersion: vi.fn() };
});
const versions = {
  rubrics: [{ id: "r1", version: 1, status: "active" as const, name: "MK Sales Score v1", dimensions: MK_SALES_RUBRIC_V1, min_assessed_weight: 50, created_at: "", activated_at: "" }],
  sops: [{ id: "s1", version: 1, status: "draft" as const, title: "Sales SOP", clauses: [{ clause_id: "MC-1", topic: "making_charges", text: "Explain making charges." }], content_sha256: "x", created_by: "u", approved_by: null, approved_at: null }],
};
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Sales score settings", () => {
  it("stays hidden when the server refuses access", async () => {
    vi.mocked(fetchAnalysisSettings).mockRejectedValue(new Error("denied"));
    const { container } = render(<ScoreSettings />);
    await waitFor(() => expect(fetchAnalysisSettings).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("switches analysis, approves an SOP and rejects bad clause JSON", async () => {
    vi.mocked(fetchAnalysisSettings).mockResolvedValue({ analysis_enabled: false, analysis_job_version: "mk-sales-v1", can_configure: true, can_manage_versions: true });
    vi.mocked(fetchScoreVersions).mockResolvedValue(versions);
    render(<ScoreSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn analysis on" }));
    await waitFor(() => expect(configureAnalysis).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(setSopStatus).toHaveBeenCalledWith("s1", "approved"));
    fireEvent.change(screen.getByLabelText("SOP title"), { target: { value: "SOP v2" } });
    fireEvent.change(screen.getByLabelText("SOP clauses JSON"), { target: { value: "not json" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft SOP" }));
    expect(await screen.findByText("The clauses are not valid JSON.")).toBeTruthy();
    expect(createSopVersion).not.toHaveBeenCalled();
  });
});
