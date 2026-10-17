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
    expect(screen.getByText(/Filled by Employee A/)).toBeTruthy();
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
});
