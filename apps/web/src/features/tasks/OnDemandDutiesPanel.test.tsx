// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { OnDemandDuty } from "@jewelos/core";
import { OnDemandDutiesPanel } from "./OnDemandDutiesPanel";

const api = vi.hoisted(() => ({ load: vi.fn(), start: vi.fn() }));
vi.mock("@/features/tasks/api", () => ({ loadMyOnDemandDuties: api.load, startOnDemandDuty: api.start }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function duty(index: number, overrides: Partial<OnDemandDuty> = {}): OnDemandDuty {
  return { templateId: `t${index}`, title: `Duty ${index}`, description: null, triggerLabel: "Per Customer", taskType: "checklist",
    priority: "medium", dueTime: "20:00:00", requiresUpload: false, startedToday: 0, completedToday: 0, openCount: 0, openTaskId: null, ...overrides };
}

it("renders nothing when the viewer has no anytime duties", async () => {
  api.load.mockResolvedValue([]);
  const { container } = render(<OnDemandDutiesPanel onOpenTask={vi.fn()} reloadKey={0} />);
  await waitFor(() => expect(api.load).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});

it("lists duties as low-priority anytime work, starts one and opens it", async () => {
  api.load.mockResolvedValue([duty(1, { completedToday: 2 }), duty(2, { triggerLabel: "As needed", taskType: "delegation" })]);
  api.start.mockResolvedValue("task-1");
  const open = vi.fn();
  const loaded = vi.fn();
  render(<OnDemandDutiesPanel onLoaded={loaded} onOpenTask={open} reloadKey={0} />);
  expect(await screen.findByText("Duty 1")).toBeTruthy();
  expect(screen.getByText("Low priority")).toBeTruthy();
  expect(screen.getByText("Done 2 today")).toBeTruthy();
  expect(screen.getByText("Upload needed")).toBeTruthy();
  expect(loaded).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole("button", { name: "Start Duty 1" }));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith("t1"));
  await waitFor(() => expect(open).toHaveBeenCalledWith("task-1"));
});

it("continues an open occurrence instead of starting another", async () => {
  api.load.mockResolvedValue([duty(1, { openCount: 1, openTaskId: "task-open" })]);
  const open = vi.fn();
  render(<OnDemandDutiesPanel onOpenTask={open} reloadKey={0} />);
  expect(await screen.findByText("1 open")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue Duty 1" }));
  expect(open).toHaveBeenCalledWith("task-open");
  expect(api.start).not.toHaveBeenCalled();
});

it("collapses a long list and searches it", async () => {
  api.load.mockResolvedValue(Array.from({ length: 9 }, (_, index) => duty(index + 1)));
  render(<OnDemandDutiesPanel onOpenTask={vi.fn()} reloadKey={0} />);
  await screen.findByText("Duty 1");
  expect(screen.queryByText("Duty 9")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));
  expect(screen.getByText("Duty 9")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search anytime duties"), { target: { value: "duty 7" } });
  expect(screen.getByText("Duty 7")).toBeTruthy();
  expect(screen.queryByText("Duty 1")).toBeNull();
});

it("shows a failure instead of hiding the duties silently", async () => {
  api.load.mockRejectedValue(new Error("Load as-needed duties: denied"));
  render(<OnDemandDutiesPanel onOpenTask={vi.fn()} reloadKey={0} />);
  expect(await screen.findByText("Load as-needed duties: denied")).toBeTruthy();
});
