// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TaskControlFilters } from "@/features/taskControl/filters";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), directory: vi.fn(), references: vi.fn() }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "admin", tenant_id: "tenant", user_role: "admin" }, access: null }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@/features/taskControl/api", () => ({ fetchTaskControlSnapshot: mocks.snapshot, fetchReportingOptions: async () => ({ branches: [], departments: [] }) }));
vi.mock("@/features/taskTemplates/api", () => ({ loadTaskTemplateDirectory: mocks.directory }));
vi.mock("@/features/tasks/api", () => ({ loadAvailabilityUsers: async () => [], loadTaskAuthoringReferenceData: mocks.references }));
vi.mock("@/features/taskControl/ReviewTab", () => ({ ReviewTab: () => <p>Review ready</p> }));
vi.mock("@/features/taskControl/TemplatesTab", () => ({ TemplatesTab: () => <p>Templates ready</p> }));
vi.mock("@/features/taskControl/FilterBar", () => ({ TaskControlFilterBar: ({ filters, onChange }: { filters: TaskControlFilters; onChange: (filters: TaskControlFilters) => void }) => <input aria-label="Test search" value={filters.search} onChange={(event) => onChange({ ...filters, search: event.target.value })} /> }));
import { TaskTemplatesPage } from "./TaskTemplatesPage";
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); window.history.replaceState({}, "", "/"); });

it("coalesces template searches without reloading authoring references", async () => {
  vi.useFakeTimers();
  window.history.replaceState({}, "", "/task-templates?tab=templates");
  mocks.directory.mockResolvedValue({ templates: [] });
  await act(async () => { render(<TaskTemplatesPage />); });
  expect(mocks.directory).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Test search"), { target: { value: "g" } });
  fireEvent.change(screen.getByLabelText("Test search"), { target: { value: "gold" } });
  await act(() => vi.advanceTimersByTimeAsync(249));
  expect(mocks.directory).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(mocks.directory).toHaveBeenCalledTimes(2);
  expect(mocks.directory).toHaveBeenLastCalledWith({ search: "gold" });
  expect(mocks.references).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
});

it("opens Review without starting hidden snapshot, templates, or authoring requests", async () => {
  window.history.replaceState({}, "", "/task-templates?tab=review");
  mocks.directory.mockResolvedValue({ templates: [] });
  mocks.references.mockReturnValue(new Promise(() => {}));
  mocks.snapshot.mockReturnValue(new Promise(() => {}));
  render(<TaskTemplatesPage />);
  expect(await screen.findByText("Review ready")).toBeTruthy();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.directory).not.toHaveBeenCalled();
  expect(mocks.references).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Templates" }));
  await waitFor(() => expect(mocks.directory).toHaveBeenCalledOnce());
  expect(await screen.findByText("Templates ready")).toBeTruthy();
  expect(mocks.references).not.toHaveBeenCalled();
});
