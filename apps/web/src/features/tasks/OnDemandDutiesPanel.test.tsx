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
    priority: "medium", dueTime: "20:00:00", requiresUpload: false, startedToday: 0, openCount: 0, ...overrides };
}

it("renders nothing when the viewer has no as-needed duties", async () => {
  api.load.mockResolvedValue([]);
  const { container } = render(<OnDemandDutiesPanel onStarted={vi.fn()} reloadKey={0} />);
  await waitFor(() => expect(api.load).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});

it("lists duties with their trigger and starts one, then refreshes the task list", async () => {
  api.load.mockResolvedValue([duty(1, { startedToday: 2, openCount: 1 }), duty(2, { triggerLabel: "As needed", taskType: "delegation" })]);
  api.start.mockResolvedValue("task-1");
  const started = vi.fn().mockResolvedValue(undefined);
  render(<OnDemandDutiesPanel onStarted={started} reloadKey={0} />);
  expect(await screen.findByText("Duty 1")).toBeTruthy();
  expect(screen.getByText("Done 2 today · 1 open")).toBeTruthy();
  expect(screen.getByText("Upload needed")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start Duty 1" }));
  await waitFor(() => expect(api.start).toHaveBeenCalledWith("t1"));
  await waitFor(() => expect(started).toHaveBeenCalled());
});

it("collapses a long list and searches it", async () => {
  api.load.mockResolvedValue(Array.from({ length: 9 }, (_, index) => duty(index + 1)));
  render(<OnDemandDutiesPanel onStarted={vi.fn()} reloadKey={0} />);
  await screen.findByText("Duty 1");
  expect(screen.queryByText("Duty 9")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all 9" }));
  expect(screen.getByText("Duty 9")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search as-needed duties"), { target: { value: "duty 7" } });
  expect(screen.getByText("Duty 7")).toBeTruthy();
  expect(screen.queryByText("Duty 1")).toBeNull();
});

it("shows a failure instead of hiding the duties silently", async () => {
  api.load.mockRejectedValue(new Error("Load as-needed duties: denied"));
  render(<OnDemandDutiesPanel onStarted={vi.fn()} reloadKey={0} />);
  expect(await screen.findByText("Load as-needed duties: denied")).toBeTruthy();
});
