// @vitest-environment jsdom
import { useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmsAssignedWorkPage, fmsFinishedNotice } from "./FmsAssignedWorkPage";

const mocks = vi.hoisted(() => ({
  loadFormDynamicOptions: vi.fn(),
  loadForms: vi.fn(),
  loadTaskForms: vi.fn(),
  confirmWork: vi.fn(),
  loadFmsAssignedStage: vi.fn(),
  recoverFmsStartingWork: vi.fn(),
  runner: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.toast } }));

vi.mock("@/features/forms/api", () => ({
  loadFormDynamicOptions: mocks.loadFormDynamicOptions,
  loadForms: mocks.loadForms,
  loadTaskForms: mocks.loadTaskForms,
}));
vi.mock("@/features/fms/FmsWorkContext", () => ({ FmsWorkContext: ({ onReady }: { onReady?: (ready: boolean) => void }) => {
  useEffect(() => { onReady?.(true); }, [onReady]);
  return <section aria-label="Previous form answers">Client name: Synthetic client</section>;
} }));
vi.mock("@/features/fms/api", () => ({ loadFmsAssignedStage: mocks.loadFmsAssignedStage }));
vi.mock("@jewelos/data/fms/work", async () => ({ ...(await vi.importActual<typeof import("@jewelos/data/fms/work")>("@jewelos/data/fms/work")), recoverFmsStartingWork: mocks.recoverFmsStartingWork, loadFmsWorkContext: vi.fn().mockRejectedValue(new Error("Optional context unavailable")), signedFmsContextFileUrl: vi.fn() }));
vi.mock("@/features/fms/useFmsHandoffConfirmation", () => ({ useFmsHandoffConfirmation: () => ({ confirmWork: mocks.confirmWork, result: null, confirmation: null }) }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "user-1", tenant_id: "tenant-1", user_role: "staff" } }) }));
vi.mock("@/features/forms/FormRenderer", () => ({
  FormRenderer: ({ onSubmit }: { onSubmit: (answers: Record<string, string>) => Promise<void> }) => (
    <button onClick={() => void onSubmit({ approved: "yes" })} type="button">Submit exact form</button>
  ),
}));
vi.mock("@/features/fms/FmsStageRunner", () => ({
  FmsStageRunner: (props: { stage: { id: string }; requestedFormTemplateId?: string; onResult?: (result: import("@jewelos/core").FmsWorkResult) => void }) => {
    mocks.runner(props);
    return <div>Running {props.stage.id} form {props.requestedFormTemplateId ?? "none"}<button onClick={() => props.onResult?.({ state: "successors_activated", submissionId: "saved", instanceId: "instance-5", referenceNumber: "FMS-9", sourceInstanceStageId: props.stage.id, destinations: [{ targetStageId: "next-def", stageName: "Follow up", formTemplateId: "form-next", selectedUserId: "user-1", effectiveUserId: "user-1", employeeName: "Current employee", assignmentMethod: "previous_form", locked: false, allowHandoff: true, issue: null }], ownWorkTargets: [{ kind: "stage_form", instanceId: "instance-5", instanceStageId: "next-visit", formTemplateId: "form-next" }] })}>Finish synthetic stage</button></div>;
  },
}));

const OPTIONS = { users: [], branches: [], departments: [], masters: [] };
beforeEach(() => { mocks.loadTaskForms.mockResolvedValue({ bundles: [], submissions: [] }); mocks.recoverFmsStartingWork.mockResolvedValue(null); });

function stageBundle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    instance: { id: "instance-5", fms_flow_id: "flow-1", reference_number: "FMS-9", title: "Repair job", status: "active" },
    instanceStages: [
      { id: "stage-3", fms_instance_id: "instance-5", fms_stage_id: "def-2", status: "pending", assigned_to: ["user-1"] },
    ],
    definitions: [{ id: "def-2", fms_flow_id: "flow-1", name: "Polishing", form_template_id: "form-7" }],
    checklist: [],
    evidence: [],
    users: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("focused FMS assigned work", () => {
  it("opens and submits the exact starter form without rendering a library", async () => {
    window.history.replaceState({}, "", "/tasks/fms?starter=starter-2&form=form-7");
    mocks.loadTaskForms.mockResolvedValue({
      bundles: [{ id: "form-7", name: "Opening details", description: null, sections: [], fields: [], version: 3 }],
      submissions: [],
    });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);
    mocks.confirmWork.mockResolvedValue({ state: "successors_activated", instanceId: "instance-5", submissionId: "sub-1", sourceInstanceStageId: null, referenceNumber: "FMS-9", destinations: [], ownWorkTargets: [] });
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    render(<FmsAssignedWorkPage onNavigate={onNavigate} />);

    expect(await screen.findByRole("heading", { name: "Opening details" })).toBeTruthy();
    expect(screen.queryByText("Forms Library")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Submit exact form" }));
    await waitFor(() => expect(mocks.confirmWork).toHaveBeenCalledWith({ kind: "starter_form", formTemplateId: "form-7", starterAssignmentId: "starter-2", answers: { approved: "yes" } }));
    // No result page: the employee goes straight back to the FMS list with a short notice.
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/tasks?view=fms"));
    expect(mocks.toast).toHaveBeenCalledOnce();
    expect(screen.queryByRole("heading", { name: "Form submitted successfully" })).toBeNull();
  });

  it("recovers a saved starting submission after its response was lost", async () => {
    window.history.replaceState({}, "", "/tasks/fms?starter=starter-2&form=form-7");
    mocks.recoverFmsStartingWork.mockResolvedValue({ submissionId: "saved", instanceId: "instance-5", referenceNumber: "FMS-9", workflowName: "Jewellery enquiry", ownWorkTargets: [], assignmentSummary: [{ stageName: "Call", employeeName: "Employee B" }] });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);
    render(<FmsAssignedWorkPage onNavigate={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Form submitted successfully" })).toBeTruthy();
    expect(screen.getByText(/Call has been assigned to Employee B/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit exact form" })).toBeNull();
    expect(mocks.confirmWork).not.toHaveBeenCalled();
  });

  it("preserves the form when starting handoff confirmation is cancelled", async () => {
    window.history.replaceState({}, "", "/tasks/fms?starter=starter-2&form=form-7");
    mocks.loadTaskForms.mockResolvedValue({
      bundles: [{ id: "form-7", name: "Opening details", description: null, sections: [], fields: [], version: 3 }],
      submissions: [],
    });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);
    mocks.confirmWork.mockResolvedValue(null);
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    render(<FmsAssignedWorkPage onNavigate={onNavigate} />);

    await user.click(await screen.findByRole("button", { name: "Submit exact form" }));
    expect(await screen.findByRole("button", { name: "Submit exact form" })).toBeTruthy();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("opens the exact runtime step and its pinned form, not the instance list", async () => {
    window.history.replaceState({}, "", "/tasks/fms?instance=instance-5&stage=stage-3&form=form-7");
    mocks.loadFmsAssignedStage.mockResolvedValue(stageBundle());
    mocks.loadForms.mockResolvedValue({ bundles: [] });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);

    render(<FmsAssignedWorkPage onNavigate={vi.fn()} />);

    expect(await screen.findByRole("region", { name: "Previous form answers" })).toBeTruthy();
    expect(screen.queryByText("Running stage-3 form form-7")).toBeNull();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue to stage form" }));
    expect(await screen.findByText("Running stage-3 form form-7")).toBeTruthy();
    // Scoped by id — never the whole-workspace loader that caps its results.
    expect(mocks.loadFmsAssignedStage).toHaveBeenCalledWith("instance-5", "stage-3");
    expect(mocks.loadForms).not.toHaveBeenCalled();
    expect(mocks.loadTaskForms).toHaveBeenCalledWith(["form-7"], []);
    expect(screen.queryByText("Live instances")).toBeNull();
    expect(screen.queryByText("No FMS instances match this view.")).toBeNull();
  });

  it("resolves a legacy instance-only link to the step waiting on this user", async () => {
    window.history.replaceState({}, "", "/tasks/fms?instance=instance-5");
    mocks.loadFmsAssignedStage.mockResolvedValue(stageBundle({
      instanceStages: [
        { id: "stage-1", fms_instance_id: "instance-5", fms_stage_id: "def-1", status: "completed", assigned_to: ["user-1"] },
        { id: "stage-3", fms_instance_id: "instance-5", fms_stage_id: "def-2", status: "pending", assigned_to: ["user-1"] },
      ],
    }));
    mocks.loadForms.mockResolvedValue({ bundles: [] });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);

    render(<FmsAssignedWorkPage onNavigate={vi.fn()} />);

    expect(await screen.findByRole("region", { name: "Previous form answers" })).toBeTruthy();
    expect(screen.queryByText("Running stage-3 form form-7")).toBeNull();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Continue to stage form" }));
    expect(await screen.findByText("Running stage-3 form form-7")).toBeTruthy();
  });

  it("says so plainly when the step is finished instead of showing a dashboard", async () => {
    window.history.replaceState({}, "", "/tasks/fms?instance=instance-5&stage=stage-9&form=form-7");
    mocks.loadFmsAssignedStage.mockResolvedValue(stageBundle());
    mocks.loadForms.mockResolvedValue({ bundles: [] });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);

    render(<FmsAssignedWorkPage onNavigate={vi.fn()} />);

    expect(await screen.findByText(/already complete or is not assigned to you/)).toBeTruthy();
    expect(screen.queryByText("Dashboard")).toBeNull();
  });

  it("reports an instance it cannot see rather than falling back to a list", async () => {
    window.history.replaceState({}, "", "/tasks/fms?instance=instance-5&stage=stage-3&form=form-7");
    mocks.loadFmsAssignedStage.mockResolvedValue(null);
    mocks.loadForms.mockResolvedValue({ bundles: [] });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);

    render(<FmsAssignedWorkPage onNavigate={vi.fn()} />);

    expect(await screen.findByText(/no longer visible to your account/)).toBeTruthy();
  });

  it("shows an explicit invalid-link state instead of a dashboard", () => {
    window.history.replaceState({}, "", "/tasks/fms?starter=starter-2");

    render(<FmsAssignedWorkPage onNavigate={vi.fn()} />);

    expect(screen.getByText("This FMS assignment link is incomplete or no longer valid.")).toBeTruthy();
    expect(screen.queryByText("Dashboard")).toBeNull();
  });
});

it("returns to the FMS list after finishing a stage instead of showing a result page", async () => {
  window.history.replaceState({}, "", "/tasks/fms?instance=instance-5&stage=stage-3&form=form-7");
  mocks.loadFmsAssignedStage.mockResolvedValue(stageBundle());
  mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);
  const onNavigate = vi.fn();
  render(<FmsAssignedWorkPage onNavigate={onNavigate} />);
  // The header names the record only: no workflow · stage · reference line.
  expect(screen.queryByText(/Repair job · Polishing · FMS-9/)).toBeNull();
  await userEvent.setup().click(await screen.findByRole("button", { name: "Continue to stage form" }));
  expect(mocks.runner).toHaveBeenLastCalledWith(expect.objectContaining({ compact: true }));
  await userEvent.setup().click(screen.getByRole("button", { name: "Finish synthetic stage" }));
  expect(onNavigate).toHaveBeenCalledWith("/tasks?view=fms");
  expect(mocks.toast).toHaveBeenCalledWith("Form submitted. Next step assigned to Current employee.");
  expect(screen.queryByRole("heading", { name: "Form submitted successfully" })).toBeNull();
});

it("words the finished notice for each outcome", () => {
  const base = { submissionId: null, destinations: [] };
  expect(fmsFinishedNotice({ ...base, state: "workflow_completed" })).toBe("Work saved. The workflow is complete.");
  expect(fmsFinishedNotice({ ...base, state: "successors_activated" })).toBe("Work saved.");
});
