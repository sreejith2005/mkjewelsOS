// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FmsFlowRecord, FmsFlowReport } from "@jewelos/core";
import type { UserProfile } from "@/types";

const mocks = vi.hoisted(() => ({ report: vi.fn(), records: vi.fn() }));
vi.mock("@/auth/AuthContext", () => ({ useAuth: () => ({ profile: { id: "me", tenant_id: "t", user_role: "staff" } as UserProfile }) }));
vi.mock("@/features/realtime/useTenantRealtimeRefresh", () => ({ useTenantRealtimeRefresh: () => undefined }));
vi.mock("@jewelos/data/fms/outcomes", () => ({ FMS_RECORD_PAGE_SIZE: 25, loadFmsFlowReport: mocks.report, loadFmsFlowRecords: mocks.records }));
vi.mock("@/features/fms/workspace/FmsInstanceDetail", () => ({ FmsInstanceDetail: ({ instanceId }: { instanceId: string }) => <div>Detail for {instanceId}</div> }));
import { FMSTasksPage, fmsRecordNextAction } from "./FMSTasksPage";

const report: FmsFlowReport = { period: { from: null, to: null }, started: 100, running: 40, onHold: 0, completed: 60, cancelled: 0, won: 30, lost: 20, doNotContact: 10, other: 0, unspecified: 0, conversionPercent: 30,
  endNodes: [{ stageKey: "sales_closed", name: "Sales Closed", outcome: "won", instances: 30 }, { stageKey: "lead_closed", name: "Lead Closed", outcome: "lost", instances: 20 }],
  stages: [{ stageKey: "intro", name: "Introduction", type: "form", instances: 100, visits: 100 }, { stageKey: "demo", name: "Demo", type: "form", instances: 75, visits: 80 }],
  completedInPeriod: { completed: 60, won: 30, lost: 20, doNotContact: 10, other: 0, unspecified: 0 } };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const running: FmsFlowRecord = { id: id(1), reference: "FMS-1", title: "ABC", name: "ABC Customer", status: "active", outcome: null, endStageName: null, closedAt: null, startedAt: "2026-10-30T04:00:00Z", updatedAt: "2026-10-30T05:00:00Z", version: 1, overdue: false,
  current: [{ visitId: id(11), stageKey: "demo", stageName: "Demo", status: "in_progress", dueAt: null, overdue: false, visitNumber: 1, assignees: ["Me"], mine: true, formTemplateId: id(99) }] };
const lost: FmsFlowRecord = { ...running, id: id(2), reference: "FMS-2", name: "GHI Customer", status: "completed", outcome: "lost", endStageName: "Lead Closed", current: [] };

beforeEach(() => { mocks.report.mockResolvedValue(report); mocks.records.mockResolvedValue({ total: 2, records: [running, lost] }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("unified FMS workspace", () => {
  it("shows the counts, one filter bar and every run in one list, without My Stages / Started by Me / Branch View", async () => {
    render(<FMSTasksPage familyId={id(50)} workflowName="Instagram Sales Funnel" />);
    expect(await screen.findByText("ABC Customer")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Instagram Sales Funnel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^100\s*Started/ })).toBeTruthy();
    expect(screen.getByText("30%")).toBeTruthy();
    expect(screen.getByText("Lost · Lead Closed")).toBeTruthy();
    for (const old of ["My Stages", "Started by Me", "Branch View"]) expect(screen.queryByText(old)).toBeNull();
    expect(screen.getByRole("button", { name: /Fill form/ })).toBeTruthy();
  });
  it("filters on the server: tapping Won, searching, and choosing a step", async () => {
    const user = userEvent.setup();
    render(<FMSTasksPage familyId={id(50)} workflowName="Funnel" />);
    await screen.findByText("ABC Customer");
    await user.click(screen.getByRole("button", { name: /^30\s*Won/ }));
    await waitFor(() => expect(mocks.records.mock.lastCall?.[1]).toMatchObject({ status: "won" }));
    await user.type(screen.getByLabelText("Search customer or reference"), "ABC");
    await waitFor(() => expect(mocks.records.mock.lastCall?.[1]).toMatchObject({ query: "ABC", status: "won" }));
    await user.selectOptions(screen.getByLabelText("Step"), "demo");
    await waitFor(() => expect(mocks.records.mock.lastCall?.[1]).toMatchObject({ stageKey: "demo" }));
    expect(mocks.records.mock.lastCall?.[2]).toBe(0);
  });
  it("uses a reporting period for both the counts and the list", async () => {
    const user = userEvent.setup();
    render(<FMSTasksPage familyId={id(50)} workflowName="Funnel" />);
    await screen.findByText("ABC Customer");
    await user.selectOptions(screen.getByLabelText("Reporting period"), "today");
    await waitFor(() => expect(mocks.report.mock.lastCall?.[1].from).toMatch(/^\d{4}-\d{2}-\d{2}$/));
    expect(mocks.records.mock.lastCall?.[1].from).toBe(mocks.report.mock.lastCall?.[1].from);
  });
  it("opens a finished run read-only from its journey button", async () => {
    const user = userEvent.setup();
    render(<FMSTasksPage familyId={id(50)} workflowName="Funnel" />);
    await screen.findByText("GHI Customer");
    const buttons = screen.getAllByRole("button", { name: "View journey" });
    await user.click(buttons[buttons.length - 1]!);
    expect(screen.getByText(`Detail for ${id(2)}`)).toBeTruthy();
  });
  it("names the next action by what is waiting", () => {
    expect(fmsRecordNextAction(running)).toEqual({ label: "Fill form", path: expect.stringContaining(id(11)) });
    expect(fmsRecordNextAction(lost)).toEqual({ label: "View journey", path: null });
    expect(fmsRecordNextAction({ ...running, current: [{ ...running.current[0]!, mine: false }] })).toEqual({ label: "View details", path: null });
  });
});
