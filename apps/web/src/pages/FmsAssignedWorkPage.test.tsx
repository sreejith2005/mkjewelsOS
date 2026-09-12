// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FmsAssignedWorkPage } from "./FmsAssignedWorkPage";

const mocks = vi.hoisted(() => ({
  loadFormDynamicOptions: vi.fn(),
  loadForms: vi.fn(),
  loadTaskForms: vi.fn(),
  submitFmsStarterAssignment: vi.fn(),
  loadFmsAssignedStage: vi.fn(),
  runner: vi.fn(),
}));

vi.mock("@/features/forms/api", () => ({
  loadFormDynamicOptions: mocks.loadFormDynamicOptions,
  loadForms: mocks.loadForms,
  loadTaskForms: mocks.loadTaskForms,
  submitFmsStarterAssignment: mocks.submitFmsStarterAssignment,
}));
vi.mock("@/features/fms/api", () => ({ loadFmsAssignedStage: mocks.loadFmsAssignedStage }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "user-1", tenant_id: "tenant-1", user_role: "staff" } }) }));
vi.mock("@/features/forms/FormRenderer", () => ({
  FormRenderer: ({ onSubmit }: { onSubmit: (answers: Record<string, string>) => Promise<void> }) => (
    <button onClick={() => void onSubmit({ approved: "yes" })} type="button">Submit exact form</button>
  ),
}));
vi.mock("@/features/fms/FmsStageRunner", () => ({
  FmsStageRunner: (props: { stage: { id: string }; requestedFormTemplateId?: string }) => {
    mocks.runner(props);
    return <div>Running {props.stage.id} form {props.requestedFormTemplateId ?? "none"}</div>;
  },
}));

const OPTIONS = { users: [], branches: [], departments: [], masters: [] };

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
    mocks.submitFmsStarterAssignment.mockResolvedValue({ instanceId: "instance-5", referenceNumber: "FMS-9" });
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    render(<FmsAssignedWorkPage onNavigate={onNavigate} />);

    expect(await screen.findByRole("heading", { name: "Opening details" })).toBeTruthy();
    expect(screen.queryByText("Forms Library")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Submit exact form" }));
    await waitFor(() => expect(mocks.submitFmsStarterAssignment).toHaveBeenCalledWith("form-7", "starter-2", { approved: "yes" }));
    // Submitting the starting form starts the process, so the user continues
    // into it rather than being dropped back on a list.
    expect(onNavigate).toHaveBeenCalledWith("/tasks/fms?instance=instance-5");
  });

  it("falls back to the work list when a replayed submission names no process", async () => {
    window.history.replaceState({}, "", "/tasks/fms?starter=starter-2&form=form-7");
    mocks.loadTaskForms.mockResolvedValue({
      bundles: [{ id: "form-7", name: "Opening details", description: null, sections: [], fields: [], version: 3 }],
      submissions: [],
    });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);
    mocks.submitFmsStarterAssignment.mockResolvedValue({ instanceId: null, referenceNumber: null });
    const onNavigate = vi.fn();
    const user = userEvent.setup();

    render(<FmsAssignedWorkPage onNavigate={onNavigate} />);

    await user.click(await screen.findByRole("button", { name: "Submit exact form" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("/tasks"));
  });

  it("opens the exact runtime step and its pinned form, not the instance list", async () => {
    window.history.replaceState({}, "", "/tasks/fms?instance=instance-5&stage=stage-3&form=form-7");
    mocks.loadFmsAssignedStage.mockResolvedValue(stageBundle());
    mocks.loadForms.mockResolvedValue({ bundles: [] });
    mocks.loadFormDynamicOptions.mockResolvedValue(OPTIONS);

    render(<FmsAssignedWorkPage onNavigate={vi.fn()} />);

    expect(await screen.findByText("Running stage-3 form form-7")).toBeTruthy();
    // Scoped by id — never the whole-workspace loader that caps its results.
    expect(mocks.loadFmsAssignedStage).toHaveBeenCalledWith("instance-5");
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
