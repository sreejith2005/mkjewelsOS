// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AvailabilityPage } from "./AvailabilityPage";

const mocks = vi.hoisted(() => ({ users: vi.fn(), entries: vi.fn(), departments: vi.fn(), save: vi.fn(), refresh: null as null | (() => Promise<void>), actorId: "admin", role: "admin" as "admin" | "staff" }));
vi.mock("@/auth/AuthContext", async () => {
  const { builtinAccessContext } = await vi.importActual<typeof import("@jewelos/core")>("@jewelos/core");
  return { useAuth: () => {
    const profile = { id: mocks.actorId, tenant_id: "tenant", user_role: mocks.role };
    return { profile, access: builtinAccessContext(profile) };
  } };
});
vi.mock("@jewelos/api-client", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ order: mocks.departments }) }) }) } }));
vi.mock("@/features/tasks/api", () => ({ loadAvailabilityUsers: mocks.users, loadAvailabilityForDate: mocks.entries, recordAvailabilityRange: mocks.save }));
vi.mock("@/features/availability/LeaveApplications", () => ({ LeaveApplications: () => null }));
vi.mock("@/lib/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: ({ refresh }: { refresh: () => Promise<void> }) => { mocks.refresh = refresh; } }));
const person = { id: "employee", employee_name: "Employee A", employee_code: "E1", user_role: "staff", department_id: "sales" };
beforeEach(() => {
  mocks.actorId = "admin"; mocks.role = "admin";
  mocks.users.mockReset().mockResolvedValue([person]);
  mocks.entries.mockReset().mockResolvedValue([]);
  mocks.departments.mockReset().mockResolvedValue({ data: [{ id: "sales", name: "Sales" }], error: null });
});
afterEach(cleanup);

it("keeps a reference failure visible across date changes and retries the roster", async () => {
  mocks.users.mockRejectedValueOnce(new Error("Roster unavailable"));
  render(<AvailabilityPage />);
  await screen.findByText("Roster unavailable");
  fireEvent.change(screen.getByLabelText("Availability start date"), { target: { value: "2026-11-10" } });
  await waitFor(() => expect(mocks.entries).toHaveBeenCalledWith("2026-11-10"));
  expect(screen.queryByText("Roster unavailable")).toBeTruthy();
  expect(screen.queryByText("No team members match the selected view.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Employee A");
  expect(screen.queryByText("Roster unavailable")).toBeNull();
});

it("keeps loading while roster references are pending even if dated entries are ready", async () => {
  mocks.users.mockReturnValue(new Promise(() => {}));
  render(<AvailabilityPage />);
  await act(async () => {});
  expect(screen.queryByText("No team members match the selected view.")).toBeNull();
  expect(screen.getByRole("status").textContent).toMatch(/loading/i);
});

it("does not count everyone present while the selected date is still loading", async () => {
  mocks.entries.mockResolvedValueOnce([{ user_profile_id: "employee", status: "absent", reason: null }]).mockReturnValueOnce(new Promise(() => {}));
  render(<AvailabilityPage />);
  await screen.findByText("1 absent");
  fireEvent.change(screen.getByLabelText("Availability start date"), { target: { value: "2026-11-10" } });
  expect(screen.queryByText("1 present")).toBeNull();
  expect(screen.queryByText("0 absent")).toBeNull();
});

it("loads only dated entries when the board date changes, and refreshes references on realtime refresh", async () => {
  render(<AvailabilityPage />);
  await screen.findByText("Employee A");
  fireEvent.change(screen.getByLabelText("Availability start date"), { target: { value: "2026-11-10" } });
  await waitFor(() => expect(mocks.entries).toHaveBeenCalledWith("2026-11-10"));
  expect(mocks.users).toHaveBeenCalledTimes(1);
  expect(mocks.departments).toHaveBeenCalledTimes(1);
  await act(async () => { await mocks.refresh?.(); });
  expect(mocks.users).toHaveBeenCalledTimes(2);
  expect(mocks.departments).toHaveBeenCalledTimes(2);
});

it("hides the old actor roster and ignores its late response after switching actors", async () => {
  let finish: ((value: typeof person[]) => void) | undefined;
  mocks.users.mockImplementationOnce(() => new Promise<typeof person[]>((resolve) => { finish = resolve; }));
  const view = render(<AvailabilityPage />);
  mocks.actorId = "another-admin";
  mocks.users.mockResolvedValue([{ ...person, id: "other", employee_name: "Employee B" }]);
  view.rerender(<AvailabilityPage />);
  await screen.findByText("Employee B");
  await act(async () => { finish?.([person]); });
  expect(screen.queryByText("Employee A")).toBeNull();
  expect(screen.getByText("Employee B")).toBeTruthy();
});

it("ignores a previous date response that arrives after the selected date", async () => {
  let finish: ((value: { user_profile_id: string; date: string; status: string; reason: null }[]) => void) | undefined;
  mocks.entries.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  render(<AvailabilityPage />);
  await waitFor(() => expect(mocks.users).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Availability start date"), { target: { value: "2026-11-10" } });
  await waitFor(() => expect(mocks.entries).toHaveBeenCalledWith("2026-11-10"));
  await screen.findByText("Employee A");
  await act(async () => { finish?.([{ user_profile_id: "employee", date: "2026-11-09", status: "absent", reason: null }]); });
  expect(screen.getByLabelText("Availability for Employee A")).toHaveProperty("value", "present");
});


it("drops team references when management permission changes and keeps only the actor roster", async () => {
  mocks.actorId = "employee";
  mocks.users.mockResolvedValue([person, { ...person, id: "peer", employee_name: "Employee B" }]);
  const view = render(<AvailabilityPage />);
  await screen.findByText("Employee B");
  mocks.role = "staff";
  view.rerender(<AvailabilityPage />);
  await waitFor(() => expect(mocks.users).toHaveBeenCalledTimes(2));
  await screen.findByText("Employee A");
  expect(screen.queryByText("Employee B")).toBeNull();
});
