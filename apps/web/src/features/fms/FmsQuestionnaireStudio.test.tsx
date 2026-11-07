// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FmsQuestionnaireStudio } from "./FmsQuestionnaireStudio";
import { newFmsStage } from "./definition";
import type { FmsData } from "./api";

const api = vi.hoisted(() => ({ loadTaskForms: vi.fn(), publishForm: vi.fn(), saveDraft: vi.fn() }));
vi.mock("@/features/forms/api", () => ({ ...api, loadFormDynamicOptions: async () => ({ users: [], branches: [], departments: [], masters: [] }) }));
vi.mock("@/features/forms/FormBuilder", () => ({ FormBuilder: () => <p>Editor</p>, formBuilderDefinition: () => ({ name: "Questions", fields: [], sections: [] }) }));
const data: FmsData = { flows: [], stages: [], assignees: [], branchRules: [], forms: [], formFields: {}, statusOptions: [], availability: [], branches: [], departments: [], users: [] };
const baseStage = newFmsStage("task", 1);
const stage = { ...baseStage, formTemplateId: "pinned", sla: { ...baseStage.sla, questionnaire: { origin: "stage" as const, draftFormId: "draft" } } };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("questionnaire recovery", () => {
  it("lets an author remove an unavailable draft link and waits for the workflow save", async () => {
    api.loadTaskForms.mockResolvedValue({ bundles: [], submissions: [] });
    let finish!: () => void;
    const onForgetDraft = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    render(<FmsQuestionnaireStudio data={data} stage={stage} workflowName="Sales" onClose={onClose} onDraftAttached={vi.fn()} onUse={vi.fn()} onForgetDraft={onForgetDraft} />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove unavailable draft link" }));
    expect(onForgetDraft).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("finishes linking an already published draft without saving or publishing it again", async () => {
    api.loadTaskForms.mockResolvedValue({ bundles: [{ id: "draft", lifecycle: "published" }], submissions: [] });
    const onUse = vi.fn(async () => undefined);
    render(<FmsQuestionnaireStudio data={data} stage={stage} workflowName="Sales" onClose={vi.fn()} onDraftAttached={vi.fn()} onUse={onUse} onForgetDraft={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use in workflow" }));
    await waitFor(() => expect(onUse).toHaveBeenCalledWith("draft"));
    expect(api.publishForm).not.toHaveBeenCalled();
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it("does not offer link removal when the request itself fails", async () => {
    api.loadTaskForms.mockRejectedValue(new Error("Network unavailable"));
    render(<FmsQuestionnaireStudio data={data} stage={stage} workflowName="Sales" onClose={vi.fn()} onDraftAttached={vi.fn()} onUse={vi.fn()} onForgetDraft={vi.fn()} />);
    expect(await screen.findByText("Network unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove unavailable draft link" })).toBeNull();
  });
  it("keeps published recovery retryable after the workflow save fails", async () => {
    api.loadTaskForms.mockResolvedValue({ bundles: [{ id: "draft", lifecycle: "published" }], submissions: [] });
    const onUse = vi.fn().mockRejectedValueOnce(new Error("Save failed")).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<FmsQuestionnaireStudio data={data} stage={stage} workflowName="Sales" onClose={onClose} onDraftAttached={vi.fn()} onUse={onUse} onForgetDraft={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Use in workflow" }));
    expect(await screen.findByText("Save failed")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use in workflow" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onUse).toHaveBeenCalledTimes(2);
  });
});
