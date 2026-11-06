// @vitest-environment jsdom
// The walk-in visit through the linked Form Builder walk-in form (owner request 2026-11-03).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crmWalkinFormCopy, type FormCrmServices } from "@jewelos/core";

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());
const lookup = vi.hoisted(() => vi.fn());
vi.mock("@/next-shim/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }), usePathname: () => "/visits/new", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc, storage: { from: () => ({ upload: vi.fn(async () => ({ error: null })), remove: vi.fn() }) } }) }));
vi.mock("@/lib/client-phone-lookup", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/client-phone-lookup")>(), lookupClientByPhone: lookup }));
vi.mock("@/components/walk-in-form", async (importOriginal) => ({ ...await importOriginal<typeof import("@/components/walk-in-form")>(), WalkInForm: () => <p>STANDARD WALK-IN FORM</p> }));

import { WalkinVisitEntry } from "@/components/walkin-visit-entry";
import { LinkedWalkinVisit, type WalkinVisitExit } from "@/components/linked-walkin-visit";
import { readLocalDraft } from "@/lib/walkin-drafts";
import { CrmFormsHostContext, type CrmFormsHost } from "@/crm-port/forms-host";

const copy = crmWalkinFormCopy({ gender: ["FEMALE"] }, [], 2026);
const link = { purpose: "walkin" as const, versionId: "wv", fieldMap: copy.fieldMap, savedAt: "x", savedBy: null, form: { templateId: "w-t", familyId: "w-f", version: 3, name: "Client walk-in visit", definition: { name: copy.name, sections: copy.sections, fields: copy.fields } } };
const queue = { id: "q1", client_name: "Asha", mobile: "919876543210", branch_id: "b1", assigned_crm_name: "CRM One", client_id: "c1", client_is_new: false, status: "pending" };
const props = { profile: { role: "salesperson", branchId: "b1", name: "Staff" }, branches: [{ id: "b1", name: "Main" }], crms: [], crmByBranch: { b1: ["CRM One"] }, salespeopleByBranch: { b1: [{ id: "s1", name: "Priya" }] }, queue, client: null };

let opened: Parameters<CrmFormsHost["renderForm"]>[0] | null = null;
const host: CrmFormsHost = { loadLinks: async () => ({ canManage: false, links: [] }), renderForm: (formProps) => { opened = formProps; return <div role="dialog" aria-label={formProps.title} />; }, renderSettings: () => null };
function renderEntry(links: { canManage: boolean; links: unknown[] }) {
  const withLinks: CrmFormsHost = { ...host, loadLinks: async () => links as never };
  return render(<QueryClientProvider client={new QueryClient()}><CrmFormsHostContext.Provider value={withLinks}><WalkinVisitEntry {...props} /></CrmFormsHostContext.Provider></QueryClientProvider>);
}
/** The linked walk-in form itself (opened over the Client Queue, or on the walk-in page). */
function renderLinked(extra?: { exit?: WalkinVisitExit; draft?: Parameters<typeof LinkedWalkinVisit>[0]["draft"] }) {
  return render(<LinkedWalkinVisit client={null} crmByBranch={props.crmByBranch} host={host} link={link} profileName="Staff" queue={queue} salespeopleByBranch={props.salespeopleByBranch} {...extra} />);
}

beforeEach(() => { opened = null; push.mockReset(); replace.mockReset(); rpc.mockReset(); lookup.mockReset(); window.localStorage.clear(); });
afterEach(cleanup);

describe("walk-in visit with a linked form", () => {
  it("keeps the standard walk-in form without a link", async () => {
    renderEntry({ canManage: false, links: [] });
    expect(await screen.findByText("STANDARD WALK-IN FORM")).toBeTruthy();
  });

  it("sends the walk-in page to the Client Queue, where the linked form opens", async () => {
    renderEntry({ canManage: false, links: [link] });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/queue?branch=b1&walkin=q1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the linked form prefilled from the queue entry, with the branch's lists and the queue client kept", async () => {
    renderLinked();
    expect(await screen.findByRole("dialog", { name: "Walk-in visit form" })).toBeTruthy();
    expect(opened!.initialText).toMatchObject({ primary_name: "Asha", primary_phone: "9876543210", crm_name: "CRM One", source_of_lead: "Walk-in", country: "India" });
    expect(opened!.submitLabel).toBe("Submit complete visit");
    const crm = opened!.crm as FormCrmServices;
    // The questions linked to Salesperson and CRM get the branch's lists; others get none.
    expect(crm.choices!("salesperson")).toEqual(["Priya"]);
    expect(crm.choices!("salesperson_handled_x")).toEqual(["Priya"]);
    expect(crm.choices!("crm_name")).toEqual(["CRM One"]);
    expect(crm.choices!("remark")).toBeNull();
    // The queue client's own number keeps the visit with that client, without a lookup.
    expect(await crm.lookup("client_phone", "9876543210")).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("saves through submit_walkin_visit_from_form and returns to the queue", async () => {
    rpc.mockResolvedValue({ data: { client_id: "c1", timeline_id: "t1", replayed: false }, error: null });
    renderLinked();
    await screen.findByRole("dialog", { name: "Walk-in visit form" });
    await opened!.onSubmit({ answers: { primary_name: "Asha", primary_phone: "9876543210", visit_status: "store_visit", salesperson: "Priya" }, display: { visit_status: "STORE VISIT", salesperson: "Priya" } });
    expect(rpc).toHaveBeenCalledWith("submit_walkin_visit_from_form", expect.objectContaining({
      p_payload: expect.objectContaining({ entry_queue_id: "q1", branch_id: "b1", client_id: "c1", visit_status: "STORE_VISIT", salesperson_id: "s1", primary_phone: "+919876543210" }),
      p_source: expect.objectContaining({ formFamilyId: "w-f", formTemplateId: "w-t", formVersion: 3, bindingVersionId: "wv" }),
    }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/queue?branch=b1&completed=Asha&completedClientId=c1"));
  });

  it("shows the walk-in error message and keeps the form open when the visit is refused", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "no" } });
    renderLinked();
    await screen.findByRole("dialog", { name: "Walk-in visit form" });
    await expect(opened!.onSubmit({ answers: { primary_name: "Asha", primary_phone: "9876543210", visit_status: "store_visit" }, display: {} })).rejects.toThrow("You are not allowed to submit a visit to the selected branch.");
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps each change on the device at once and in CRM shortly after, and resumes from a draft", async () => {
    rpc.mockResolvedValue({ data: { entry_queue_id: "q1" }, error: null });
    renderLinked({ draft: { answers: { remark: "Liked bangles" }, meta: { submissionKey: "11111111-1111-4111-8111-111111111111", proposedTimelineId: "22222222-2222-4222-8222-222222222222" } } });
    await screen.findByRole("dialog", { name: "Walk-in visit form" });
    expect(opened!.initialAnswers).toEqual({ remark: "Liked bangles" });
    opened!.onAnswersChange!({ remark: "Liked bangles and chains" });
    expect(readLocalDraft("q1")).toMatchObject({ formFamilyId: "w-f", formVersion: 3, answers: { remark: "Liked bangles and chains" }, serverSaved: false, meta: { submissionKey: "11111111-1111-4111-8111-111111111111" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_walkin_visit_draft", expect.objectContaining({ p_entry_queue_id: "q1", p_form_family_id: "w-f", p_form_version: 3, p_answers: { remark: "Liked bangles and chains" } })), { timeout: 3000 });
    await waitFor(() => expect(readLocalDraft("q1")?.serverSaved).toBe(true));
  });

  it("closing the form returns to the queue and keeps the answers", async () => {
    const exit = { onClose: vi.fn(), onSaved: vi.fn(), onQueuedOffline: vi.fn() };
    rpc.mockResolvedValue({ data: {}, error: null });
    renderLinked({ exit });
    await screen.findByRole("dialog", { name: "Walk-in visit form" });
    opened!.onAnswersChange!({ remark: "Interrupted" });
    opened!.onClose();
    expect(exit.onClose).toHaveBeenCalled();
    expect(readLocalDraft("q1")?.answers).toEqual({ remark: "Interrupted" });
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("save_walkin_visit_draft", expect.anything()));
  });

  it("opened from the queue, a saved visit goes back to the queue through the exit", async () => {
    const exit = { onClose: vi.fn(), onSaved: vi.fn(), onQueuedOffline: vi.fn() };
    rpc.mockResolvedValue({ data: { client_id: "c1", timeline_id: "t1", replayed: false }, error: null });
    renderLinked({ exit });
    await screen.findByRole("dialog", { name: "Walk-in visit form" });
    await opened!.onSubmit({ answers: { primary_name: "Asha", primary_phone: "9876543210", visit_status: "store_visit" }, display: { visit_status: "STORE VISIT" } });
    expect(exit.onSaved).toHaveBeenCalledWith({ primaryName: "Asha", clientId: "c1" });
    expect(push).not.toHaveBeenCalled();
  });

  it("without network the visit waits on the device with its submission key", async () => {
    const exit = { onClose: vi.fn(), onSaved: vi.fn(), onQueuedOffline: vi.fn() };
    rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    try {
      renderLinked({ exit, draft: { answers: {}, meta: { submissionKey: "33333333-3333-4333-8333-333333333333" } } });
      await screen.findByRole("dialog", { name: "Walk-in visit form" });
      await opened!.onSubmit({ answers: { primary_name: "Asha", primary_phone: "9876543210", visit_status: "store_visit" }, display: { visit_status: "STORE VISIT" } });
      expect(exit.onQueuedOffline).toHaveBeenCalledWith("Asha");
      const kept = readLocalDraft("q1");
      expect(kept?.meta.submissionKey).toBe("33333333-3333-4333-8333-333333333333");
      expect(kept?.pending).toMatchObject({ primaryName: "Asha", payload: expect.objectContaining({ entry_queue_id: "q1", visit_status: "STORE_VISIT" }) });
    } finally { online.mockRestore(); }
  });

  it("with network, a lost answer still asks to submit again (same key, never twice)", async () => {
    rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    renderLinked();
    await screen.findByRole("dialog", { name: "Walk-in visit form" });
    await expect(opened!.onSubmit({ answers: { primary_name: "Asha", primary_phone: "9876543210", visit_status: "store_visit" }, display: {} })).rejects.toThrow("the visit will not be saved twice");
    expect(readLocalDraft("q1")?.pending).toBeUndefined();
  });
});
