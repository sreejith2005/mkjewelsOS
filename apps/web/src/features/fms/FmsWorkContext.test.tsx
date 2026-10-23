// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmsWorkContext } from "./FmsWorkContext";
const mocks = vi.hoisted(() => ({ load: vi.fn(), forms: vi.fn(), sign: vi.fn() }));
vi.mock("@jewelos/data/fms/work", () => ({ loadFmsWorkContext: mocks.load, loadFmsPreviousForms: mocks.forms, signedFmsContextFileUrl: mocks.sign }));
const context = { workflowName: "Enquiry", stageName: "Call", reference: "FMS-1", instructions: "Call the client", expectedResult: "Record the response", dueAt: null, assignedNames: ["Employee B"], titleTemplate: "", shortDescription: "", dueLabel: "Due", receivedFields: [], journey: [], nextCursor: null };
const field = { sourceStageKey: "initial", submissionId: "submission", formTemplateId: "form", formName: "Initial enquiry", formVersion: 1, field: { key: "client", label: "Client name", type: "text", sortOrder: 0 }, value: "Synthetic client" };
const group = { id: "visit-1", stageName: "Initial", visitNumber: 1, isInitial: true, submittedAt: null, submittedBy: "Employee A", fields: [field] };
beforeEach(() => { mocks.load.mockResolvedValue(context); mocks.forms.mockResolvedValue({ forms: [group], nextCursor: null }); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("previous form details", () => {
  it("shows questions, answers and their filler before marking details ready", async () => {
    const ready = vi.fn(); render(<FmsWorkContext instanceId="instance" instanceStageId="stage" onReady={ready} />);
    expect(await screen.findByText("Client name")).toBeTruthy();
    expect(screen.getByText("Synthetic client")).toBeTruthy();
    expect(screen.getByText(/Employee A/)).toBeTruthy();
    // The opening card already named these; the page does not repeat them.
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Enquiry");
    expect(text).not.toContain("FMS-1");
    expect(text).not.toContain("Employee B");
    expect(text).not.toContain("Your step");
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true));
    expect(mocks.forms).toHaveBeenCalledWith("instance", "stage");
  });
  it("retains loaded answers while paginating older forms", async () => {
    mocks.forms.mockResolvedValueOnce({ forms: [group], nextCursor: "10" }).mockResolvedValueOnce({ forms: [{ ...group, id: "visit-2", stageName: "Call", isInitial: false, fields: [{ ...field, value: "Older answer" }] }], nextCursor: null });
    render(<FmsWorkContext instanceId="instance" instanceStageId="stage" />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Load earlier forms" }));
    expect(await screen.findByText("Older answer")).toBeTruthy();
    expect(screen.getByText("Synthetic client")).toBeTruthy();
    expect(mocks.forms).toHaveBeenLastCalledWith("instance", "stage", "10");
  });
  it("keeps completion gated on a failed context read and allows retry", async () => {
    mocks.forms.mockRejectedValueOnce(new Error("Unavailable"));
    const ready = vi.fn(); render(<FmsWorkContext instanceId="instance" instanceStageId="stage" onReady={ready} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Retry form details" }));
    expect(await screen.findByText("Synthetic client")).toBeTruthy();
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true));
  });
  it("puts the employee's task first and shows every answer in plain words", async () => {
    const id = "00000000-0000-4000-8000-000000000009";
    const at = (key: string, label: string, type: string, value: unknown, extra: Record<string, unknown> = {}) => ({ ...field, field: { key, label, type, sortOrder: 0 }, value, ...extra });
    mocks.forms.mockResolvedValue({ nextCursor: null, forms: [{ ...group, submittedAt: "2026-10-22T09:00:00Z", fields: [
      field, at("visit", "Visit date", "date", "2026-10-21"), at("branch", "Branch", "branch_dropdown", id, { valueLabel: null }),
      at("a", "Budget", "text", null), at("b", "Occasion", "text", null), at("c", "Referral", "text", null),
    ] }] });
    render(<FmsWorkContext instanceId="instance" instanceStageId="stage" />);
    expect(await screen.findByRole("heading", { name: /What you need to do/ })).toBeTruthy();
    expect(screen.getByText("Call the client")).toBeTruthy();
    expect(screen.getByText("21 Oct 2026")).toBeTruthy();
    expect(screen.getByText("No longer available")).toBeTruthy();
    expect(screen.getByText(/22 Oct 2026, 2:30 pm/)).toBeTruthy();
    expect(screen.getByText("3 questions were not answered")).toBeTruthy();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain(id);
    expect(text).not.toContain("[object Object]");
  });
  it("folds the previous answers away once the employee continues to their work", async () => {
    const { rerender } = render(<FmsWorkContext instanceId="instance" instanceStageId="stage" />);
    const answers = (await screen.findByText("Previous form answers")).closest("details")!;
    expect(answers.open).toBe(true);
    rerender(<FmsWorkContext collapsed instanceId="instance" instanceStageId="stage" />);
    expect(answers.open).toBe(false);
  });
});
