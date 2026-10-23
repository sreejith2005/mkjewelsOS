// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FmsTransitionRequest, FmsWorkPreview } from "@jewelos/core";
import { defaultFmsHandoffChoices, FmsHandoffConfirmation } from "./FmsHandoffConfirmation";
const list = vi.hoisted(() => vi.fn());
const check = vi.hoisted(() => vi.fn());
vi.mock("@jewelos/data/fms/work", () => ({ listFmsHandoffRecipients: list, previewFmsWork: check }));
const request: FmsTransitionRequest = { kind: "complete", instanceStageId: "visit", outcome: "", remark: "", checklist: {} };
const preview: FmsWorkPreview = { fingerprint: "preview", currentStageName: "Introduction Call", wouldDefer: false, requirements: [],
  destinations: [{ targetStageId: "demo", stageName: "Product Demonstration", selectedUserId: "c", effectiveUserId: "c", employeeName: "Employee C",
    formTemplateId: null, assignmentMethod: "previous_form", allowHandoff: true, locked: false, issue: null }] };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("pre-transition handoff confirmation", () => {
  it("shows the proposed destination and confirms without mutating work itself", async () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<FmsHandoffConfirmation request={request} preview={preview} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole("dialog").textContent).toContain("Product Demonstration");
    expect(screen.getByRole("dialog").textContent).toContain("Employee C");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Selected Employee" }));
    expect(onConfirm).toHaveBeenCalledWith({ handoffs: [], preview });
  });
  it("loads eligible replacements and preserves the form on cancel", async () => {
    list.mockResolvedValue({ people: [{ id: "d", employeeName: "Employee D", designation: "Sales", branch: "Main", department: "Retail" }], nextCursor: null });
    const coveredPreview = { ...preview, fingerprint: "chosen-preview", destinations: [{ ...preview.destinations[0]!, selectedUserId: "d", effectiveUserId: "e", selectedEmployeeName: "Employee D", employeeName: "Employee E" }] };
    check.mockResolvedValue(coveredPreview);
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<FmsHandoffConfirmation request={request} preview={preview} onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to a Different Employee" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Employee D/ }));
    await screen.findByText("Assigned employee through availability coverage: Employee E");
    await waitFor(() => expect((screen.getByRole("button", { name: "Confirm Next Work" }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Next Work" }));
    expect(check).toHaveBeenCalledWith(request, [{ targetStageId: "demo", userProfileId: "d" }]);
    expect(onConfirm).toHaveBeenCalledWith({ handoffs: [{ targetStageId: "demo", userProfileId: "d" }], preview: coveredPreview });
    await userEvent.click(screen.getByRole("button", { name: "Cancel and Return to Form" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
  it("keeps a step nobody owns with the employee completing the work, checked by the server", async () => {
    const unowned = { ...preview, destinations: [{ ...preview.destinations[0]!, selectedUserId: null, effectiveUserId: null, employeeName: null, assignmentMethod: "manual_handoff", issue: "Select an eligible employee before confirming." }] } as FmsWorkPreview;
    const checked = { ...preview, fingerprint: "self", destinations: [{ ...preview.destinations[0]!, selectedUserId: "me", effectiveUserId: "me", employeeName: "Asha", assignmentMethod: "manual_handoff" }] };
    check.mockResolvedValue(checked);
    const onConfirm = vi.fn();
    render(<FmsHandoffConfirmation actor={{ id: "me", name: "Asha" }} request={request} preview={unowned} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.getByText("Asha (you)")).toBeTruthy();
    expect(screen.queryByText("Select an eligible employee before confirming.")).toBeNull();
    expect(screen.queryByText(/Choose an employee for every next step/)).toBeNull();
    expect(screen.getByText("Should someone else do this step?")).toBeTruthy();
    expect(check).toHaveBeenCalledWith(request, [{ targetStageId: "demo", userProfileId: "me" }]);
    const confirm = screen.getByRole("button", { name: "Confirm Next Work" }) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith({ handoffs: [{ targetStageId: "demo", userProfileId: "me" }], preview: checked });
  });
  it("opens the employee list inside the step and lets the employee return the step to themselves", async () => {
    list.mockResolvedValue({ people: [{ id: "d", employeeName: "Employee D", designation: "Sales", branch: "Main", department: "Retail" }], nextCursor: null });
    check.mockImplementation((_request: unknown, choices: Array<{ userProfileId: string }>) => Promise.resolve({ ...preview, fingerprint: choices[0]!.userProfileId }));
    const unowned = { ...preview, destinations: [{ ...preview.destinations[0]!, selectedUserId: null, effectiveUserId: null, employeeName: null, issue: "Select an eligible employee before confirming." }] } as FmsWorkPreview;
    render(<FmsHandoffConfirmation actor={{ id: "me", name: "Asha" }} request={request} preview={unowned} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to a Different Employee" }));
    const picker = screen.getByRole("group", { name: "Eligible employee picker" });
    expect(picker.closest("article")).toBeTruthy();
    await userEvent.click(await screen.findByRole("radio", { name: /Employee D/ }));
    expect(screen.queryByRole("group", { name: "Eligible employee picker" })).toBeNull();
    expect(screen.getByText("Employee D")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Keep it with me" }));
    expect(screen.getByText("Asha (you)")).toBeTruthy();
  });
  it("does not default a fixed-owner step to the employee", () => {
    expect(defaultFmsHandoffChoices({ ...preview, destinations: [{ ...preview.destinations[0]!, effectiveUserId: null, locked: true, allowHandoff: false }] }, { id: "me", name: "Asha" })).toEqual({});
    expect(defaultFmsHandoffChoices(preview, { id: "me", name: "Asha" })).toEqual({});
  });
  it("makes the fixed-owner exception visible and disables replacement", () => {
    render(<FmsHandoffConfirmation request={request} preview={{ ...preview, destinations: [{ ...preview.destinations[0]!, locked: true, allowHandoff: false }] }} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/Fixed employee.*locked/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign to a Different Employee" })).toBeNull();
  });
  it("shows pending requirements and uses final confirmation without an employee picker", () => {
    render(<FmsHandoffConfirmation request={request} preview={{ ...preview, destinations: [], wouldDefer: true, requirements: ["Manager approval is required"] }} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Manager approval is required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm Completion" })).toBeTruthy();
  });
});
