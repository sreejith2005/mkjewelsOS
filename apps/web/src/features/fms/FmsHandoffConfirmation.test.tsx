// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FmsTransitionRequest, FmsWorkPreview } from "@jewelos/core";
import { FmsHandoffConfirmation } from "./FmsHandoffConfirmation";
const list = vi.hoisted(() => vi.fn());
vi.mock("@jewelos/data/fms/work", () => ({ listFmsHandoffRecipients: list }));
const request: FmsTransitionRequest = { kind: "complete", instanceStageId: "visit", outcome: "", remark: "", checklist: {} };
const preview: FmsWorkPreview = { fingerprint: "preview", currentStageName: "Introduction Call", wouldDefer: false, requirements: [],
  destinations: [{ targetStageId: "demo", stageName: "Product Demonstration", selectedUserId: "c", effectiveUserId: "c", employeeName: "Employee C",
    formTemplateId: null, assignmentMethod: "previous_form", allowHandoff: true, locked: false, issue: null }] };
afterEach(cleanup);
describe("pre-transition handoff confirmation", () => {
  it("shows the proposed destination and confirms without mutating work itself", async () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<FmsHandoffConfirmation request={request} preview={preview} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByRole("dialog").textContent).toContain("Product Demonstration");
    expect(screen.getByRole("dialog").textContent).toContain("Employee C");
    await userEvent.click(screen.getByRole("button", { name: "Continue with Selected Employee" }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });
  it("loads eligible replacements and preserves the form on cancel", async () => {
    list.mockResolvedValue({ people: [{ id: "d", employeeName: "Employee D", designation: "Sales", branch: "Main", department: "Retail" }], nextCursor: null });
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<FmsHandoffConfirmation request={request} preview={preview} onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole("button", { name: "Assign to a Different Employee" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Employee D/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm Next Work" }));
    expect(onConfirm).toHaveBeenCalledWith([{ targetStageId: "demo", userProfileId: "d" }]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel and Return to Form" }));
    expect(onCancel).toHaveBeenCalledOnce();
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
