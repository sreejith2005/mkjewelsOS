// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
const rpc = vi.fn();
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ push, refresh }) })); // crm-port: next/navigation -> local shim module
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> })); // crm-port: next/link -> local shim module
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { client_code: "MKC-102727" } }) }) }) }) }) }));

import { EntryQueue } from "@/components/entry-queue";

it("keeps assigned-branch controls operable without offering other branches", () => {
  render(<EntryQueue profile={{role:"salesperson",branchId:"own"}} selectedBranchId="own" selectedCrm="" branches={[{id:"own",name:"Own branch"},{id:"other",name:"Other branch"}]} crms={[]} queueCrms={[]} initialItems={[]} />);
  for (const select of screen.getAllByLabelText("BRANCH")) {
    expect((select as HTMLSelectElement).disabled).toBe(false);
    expect(Array.from((select as HTMLSelectElement).options).map(option=>option.value)).toEqual(["own"]);
  }
});

const branchId = "10000000-0000-4000-8000-000000000601";
function renderQueue() {
  return render(<EntryQueue profile={{ role: "salesperson", branchId }} selectedBranchId={branchId} selectedCrm="" branches={[{ id: branchId, name: "Test Branch" }]} crms={["Test CRM"]} queueCrms={["Test CRM"]} initialItems={[{ id: "queue-1", token: "0725-ABCDE", client_name: "Queued Client", mobile: "9012345601", assigned_crm_name: "Test CRM", status: "pending", created_at: "2026-07-25T09:00:00Z", client_id: null }, { id: "queue-2", token: "0725-DONE01", client_name: "Submitted Client", mobile: "9012345603", assigned_crm_name: "Test CRM", status: "complete", created_at: "2026-07-25T10:00:00Z", client_id: "client-2" }]} />);
}

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("consolidated client walk-in queue", () => {
  it("registers in place, preserves entered values, and exposes only queue-originated walk-in actions", async () => {
    rpc.mockImplementation((name: string) => name === "lookup_client_by_phone" ? Promise.resolve({ data: [], error: null }) : Promise.resolve({ data: [{ token: "0725-NEW01", client_code: "MKC-102726", client_type: "new" }], error: null }));
    renderQueue();
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "New Queue Client" } });
    fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "9012345602" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTER CLIENT" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Client ID: MKC-102726"));
    expect(screen.getByDisplayValue("New Queue Client")).toBeTruthy();
    expect(screen.getByDisplayValue("9012345602")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Walk-in form" }).getAttribute("href")).toBe("/visits/new?queue=queue-1");
    expect(screen.queryByText("Direct walk-in")).toBeNull();
  });

  it("requires a country code (India first) and registers the number with it", async () => {
    rpc.mockImplementation((name: string) => name === "lookup_client_by_phone" ? Promise.resolve({ data: [], error: null }) : Promise.resolve({ data: [{ token: "0725-NEW02", client_code: "MKC-102728", client_type: "new" }], error: null }));
    renderQueue();
    const countryCode = screen.getByLabelText("Country code") as HTMLSelectElement;
    expect(countryCode.required).toBe(true);
    expect(countryCode.value).toBe("91");
    expect(countryCode.options[0]!.textContent).toBe("+91 India");
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Gulf Queue Client" } });
    fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "90123456" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTER CLIENT" }));
    expect(screen.getByRole("status").textContent).toBe("Enter a 10-digit mobile number for India (+91).");
    expect(rpc).not.toHaveBeenCalledWith("register_walkin_entry", expect.anything());
    fireEvent.change(countryCode, { target: { value: "971" } });
    fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "50 123 4567" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTER CLIENT" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("register_walkin_entry", expect.objectContaining({ p_mobile: "+971501234567" })));
  });

  it("shows queued numbers with their country code", () => {
    render(<EntryQueue profile={{ role: "salesperson", branchId }} selectedBranchId={branchId} selectedCrm="" branches={[{ id: branchId, name: "Test Branch" }]} crms={[]} queueCrms={[]} initialItems={[
      { id: "q-in", token: "T1", client_name: "Indian Client", mobile: "919012345601", assigned_crm_name: null, status: "pending", created_at: "2026-10-07T10:00:00Z", client_id: null },
      { id: "q-ae", token: "T2", client_name: "Gulf Client", mobile: "971501234567", assigned_crm_name: null, status: "pending", created_at: "2026-10-07T10:00:00Z", client_id: null },
    ]} />);
    expect(screen.getByText("+91 9012345601")).toBeTruthy();
    expect(screen.getByText("+971 501234567")).toBeTruthy();
  });

  it("keeps completed visits out of the active queue but makes them reviewable in Recently submitted", () => {
    renderQueue();
    expect(screen.queryByText("Submitted Client")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recently submitted" }));
    expect(screen.getByText("Submitted Client")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View client" }).getAttribute("href")).toBe("/clients/client-2");
  });

  it("loads the branch and CRM filter into the canonical queue URL", () => {
    renderQueue();
    fireEvent.change(screen.getByLabelText("CRM NAME"), { target: { value: "TEST CRM" } });
    fireEvent.click(screen.getByRole("button", { name: "LOAD QUEUE" }));
    expect(push).toHaveBeenCalledWith(`/queue?branch=${branchId}&crm=TEST+CRM`);
  });

  it("shows each waiting person as one plain row: name, badge, phone, time, CRM and one action (owner 2026-11-05)", () => {
    renderQueue();
    const row = screen.getByRole("listitem");
    expect(row.querySelector("table")).toBeNull();
    expect(row.textContent).toContain("Queued Client");
    expect(row.textContent).toContain("CRM: Test CRM");
    expect(row.querySelectorAll("a")).toHaveLength(1);
    expect(row.closest(".overflow-x-auto")).toBeNull();
  });

  it("keeps CRM NAME, BRANCH and LOAD QUEUE always visible, with no Filters disclosure", () => {
    renderQueue();
    const toolbar = screen.getByRole("group", { name: "Queue selection" });
    expect(toolbar.closest("details")).toBeNull();
    expect(screen.queryByText("Filters")).toBeNull();
    expect(screen.getByLabelText("CRM NAME")).toBeTruthy();
    expect(screen.getByRole("button", { name: "LOAD QUEUE" })).toBeTruthy();
  });

  it("lists every CRM-department person of the branch chosen in BRANCH at once, marking who is away today", () => {
    const other = "10000000-0000-4000-8000-000000000602";
    render(<EntryQueue profile={{ role: "super_admin", branchId: null }} requestedBranch={branchId} selectedBranchId={branchId} selectedCrm="" branches={[{ id: branchId, name: "Test Branch" }, { id: other, name: "Other Branch" }]} crms={[]} queueCrms={[]} initialItems={[]}
      rosterByBranch={{ [branchId]: [{ crm_name: "ASHA", available: true }, { crm_name: "BINA", available: false }], [other]: [{ crm_name: "CHITRA", available: true }] }} />);
    const crmOptions = () => Array.from((screen.getByLabelText("CRM NAME") as HTMLSelectElement).options).map((option) => option.textContent);
    expect(crmOptions()).toEqual(["ALL CRM", "ASHA", "BINA (NOT AVAILABLE TODAY)"]);
    expect(screen.getByText("In today: ASHA")).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText("BRANCH")[1]!, { target: { value: other } });
    expect(crmOptions()).toEqual(["ALL CRM", "CHITRA"]);
  });

  it("explains an empty roster to managers instead of showing a blank list", () => {
    render(<EntryQueue profile={{ role: "super_admin", branchId: null }} requestedBranch={branchId} selectedBranchId={branchId} selectedCrm="" branches={[{ id: branchId, name: "Test Branch" }]} crms={[]} queueCrms={[]} initialItems={[]}
      rosterByBranch={{}} rosterHealth={{ crm_department_people: 2, on_roster: 0, not_on_roster: [{ outcome: "blocked", reason: "unmapped_branch", count: 2 }], last_staff_sync_at: null, master_snapshot_at: null }}
      branchSetup={{ source: "crm_branches", issues: [{ label: "MK Typo", reason: "no_jewelos_branch" }] }} />);
    expect(screen.getByText(/No CRM staff for this branch\. 2 missing: their JewelOS branch has no CRM branch/)).toBeTruthy();
    // Branch-list setup notes are not shown on the queue (owner 2026-11-05).
    expect(screen.queryByText(/CRM Branches|MK Typo|Not offered/)).toBeNull();
  });

  it("opens the existing pending entry instead of registering the same person twice today", async () => {
    rpc.mockImplementation((name: string) => name === "lookup_client_by_phone" ? Promise.resolve({ data: [], error: null }) : Promise.resolve({ data: [{ id: "queue-1", token: "0725-ABCDE", client_name: "Queued Client", client_code: "MKC-1", client_type: "pending_duplicate" }], error: null }));
    renderQueue();
    fireEvent.change(screen.getAllByRole("textbox")[0]!, { target: { value: "Queued Client" } });
    fireEvent.change(screen.getByLabelText("Mobile Number"), { target: { value: "9012345601" } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTER CLIENT" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("is already waiting in the queue today (token 0725-ABCDE)"));
    expect(screen.getByRole("link", { name: "Open that entry" }).getAttribute("href")).toBe("/visits/new?queue=queue-1");
    expect(refresh).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
  it("labels a registered new client New although registration already created the client (QA fix 2026-10-05)", () => {
    render(<EntryQueue profile={{ role: "salesperson", branchId }} selectedBranchId={branchId} selectedCrm="" branches={[{ id: branchId, name: "Test Branch" }]} crms={["Test CRM"]} queueCrms={["Test CRM"]} initialItems={[
      { id: "queue-new", token: "1005-NEW01", client_name: "Brand New", mobile: "9012345611", assigned_crm_name: "Test CRM", status: "pending", created_at: "2026-10-05T09:00:00Z", client_id: "client-new", client_is_new: true },
      { id: "queue-old", token: "1005-OLD01", client_name: "Returning", mobile: "9012345612", assigned_crm_name: "Test CRM", status: "pending", created_at: "2026-10-05T09:05:00Z", client_id: "client-old", client_is_new: false },
    ]} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows.find((row) => row.textContent?.includes("Brand New"))?.textContent).toContain("New");
    expect(rows.find((row) => row.textContent?.includes("Returning"))?.querySelector(".crm-queue-badge")?.textContent).toBe("Returning");
  });
});

describe("walk-in form opened over the queue (owner request 2026-11-06)", () => {
  const items = [
    { id: "queue-a", token: "T-A", client_name: "Started Client", mobile: "9012345611", assigned_crm_name: "Test CRM", status: "pending", created_at: "2026-11-06T04:00:00Z", client_id: "c-a" },
    { id: "queue-b", token: "T-B", client_name: "Fresh Client", mobile: "9012345612", assigned_crm_name: "Test CRM", status: "pending", created_at: "2026-11-06T04:05:00Z", client_id: "c-b" },
    { id: "queue-c", token: "T-C", client_name: "Offline Client", mobile: "9012345613", assigned_crm_name: "Test CRM", status: "pending", created_at: "2026-11-06T04:10:00Z", client_id: "c-c" },
  ];
  it("marks started forms, offers Continue form and Start over, and opens the form in place", () => {
    const open = vi.fn(); const startOver = vi.fn();
    const markers = new Map([
      ["queue-a", { queueId: "queue-a", startedBy: "PRIYA", updatedBy: "PRIYA", updatedAt: "2026-11-06T05:30:00.000Z", state: "draft" as const, onThisDevice: false }],
      ["queue-c", { queueId: "queue-c", startedBy: null, updatedBy: null, updatedAt: "2026-11-06T05:40:00.000Z", state: "waiting" as const, onThisDevice: true }],
    ]);
    render(<EntryQueue profile={{ role: "salesperson", branchId }} selectedBranchId={branchId} selectedCrm="" branches={[{ id: branchId, name: "Test Branch" }]} crms={[]} queueCrms={[]} initialItems={items} draftMarkers={markers} onOpenWalkin={open} onStartOver={startOver} />);
    expect(screen.getByText(/Form started, not finished · saved .* by PRIYA/)).toBeTruthy();
    expect(screen.getByText(/sends automatically when the network is back/)).toBeTruthy();
    expect(screen.getByText("Waiting to send")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Walk-in form" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue form" }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "queue-a" }));
    fireEvent.click(screen.getByRole("button", { name: "Walk-in form" }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "queue-b" }));
    fireEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(startOver).toHaveBeenCalledWith(expect.objectContaining({ id: "queue-a" }));
  });
});
