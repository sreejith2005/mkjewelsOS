// @vitest-environment jsdom
// CRM registration through Form Builder forms linked in CRM Form Settings (owner request 2026-11-03).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormTemplateDefinition } from "@jewelos/core";

const navigation = vi.hoisted(() => ({ search: "?register=client", push: vi.fn(), refresh: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
const runo = vi.hoisted(() => vi.fn());
vi.mock("@/next-shim/navigation", () => ({
  usePathname: () => "/queue",
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: navigation.push, refresh: navigation.refresh }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/crm-port/phase4", () => ({ pushLeadToRuno: runo }));
vi.mock("@/components/lead-form", () => ({ LeadForm: () => <p>STANDARD LEAD FORM</p> }));
vi.mock("@/components/entry-queue", () => ({
  EntryQueue: ({ registration }: { registration?: (context: { branch: string; branchSelect: React.ReactNode; onRegistered: (saved: unknown) => void }) => React.ReactNode }) =>
    registration ? <div>{registration({ branch: "branch-1", branchSelect: <span>BRANCH</span>, onRegistered: (saved) => { registered.push(saved); } })}</div> : <p>STANDARD QUEUE FORM</p>,
}));
const registered: unknown[] = [];

import { WalkinStart } from "@/components/walkin-start";
import { CrmFormsHostContext, type CrmFormLinks, type CrmFormsHost, type CrmSubmittedForm } from "@/crm-port/forms-host";

const queueDefinition: FormTemplateDefinition = { name: "Queue", fields: [
  { key: "who", label: "Client name", type: "text", sortOrder: 0, required: true, validation: { width: "half" } },
  { key: "tel", label: "Mobile", type: "phone", sortOrder: 1, required: true, validation: { width: "half" } },
] };
const leadDefinition: FormTemplateDefinition = { name: "Lead", fields: [
  { key: "nm", label: "Name", type: "text", sortOrder: 0, required: true },
  { key: "mob", label: "Mobile", type: "phone", sortOrder: 1, required: true },
  { key: "born", label: "Date of birth", type: "date", sortOrder: 2 },
] };
const leadFields = [
  { id: "f1", field_key: "name", label: "Name", field_type: "text" as const, is_mandatory: true, is_hidden: false, display_order: 1, is_runo_synced: false, runo_field_name: null, option_source: null },
  { id: "f2", field_key: "mobile_no", label: "Mobile no", field_type: "text" as const, is_mandatory: true, is_hidden: false, display_order: 2, is_runo_synced: false, runo_field_name: null, option_source: null },
  { id: "f3", field_key: "dob", label: "Date of birth", field_type: "date" as const, is_mandatory: false, is_hidden: false, display_order: 3, is_runo_synced: false, runo_field_name: null, option_source: null },
];
const form = (definition: FormTemplateDefinition, id: string) => ({ templateId: `${id}-template`, familyId: `${id}-family`, version: 2, name: definition.name, definition });
const queueLink = { purpose: "queue" as const, versionId: "qv", fieldMap: { client_name: "who", mobile: "tel" }, savedAt: "2026-11-03T10:00:00Z", savedBy: "Owner", form: form(queueDefinition, "q") };
const leadLink = { purpose: "lead" as const, versionId: "lv", fieldMap: { name: "nm", mobile_no: "mob", dob: "born" }, savedAt: "2026-11-03T10:00:00Z", savedBy: "Owner", form: form(leadDefinition, "l") };

let submitForm: ((submitted: CrmSubmittedForm) => Promise<void>) | null = null;
function host(links: CrmFormLinks): CrmFormsHost {
  return {
    loadLinks: async () => links,
    renderForm: ({ title, onSubmit }) => { submitForm = onSubmit; return <div role="dialog" aria-label={title}>LINKED FORM</div>; },
    renderSettings: () => <div role="dialog" aria-label="CRM Form Settings">SETTINGS</div>,
  };
}
function renderStart(links: CrmFormLinks | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CrmFormsHostContext.Provider value={links ? host(links) : null}>
    <WalkinStart entryQueueProps={{} as never} fields={leadFields} options={[]} lookupOptions={{}} actorId="actor" />
  </CrmFormsHostContext.Provider></QueryClientProvider>);
}

beforeEach(() => { navigation.search = "?register=client"; rpc.mockReset(); runo.mockReset(); registered.length = 0; submitForm = null; vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("key-1").mockReturnValueOnce("key-2").mockReturnValue("key-n") }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("client queue registration with a linked form", () => {
  it("keeps the standard queue form when nothing is linked or the host has no forms", async () => {
    renderStart({ canManage: false, links: [] });
    expect(await screen.findByText("STANDARD QUEUE FORM")).toBeTruthy();
    cleanup();
    renderStart(null);
    expect(screen.getByText("STANDARD QUEUE FORM")).toBeTruthy();
  });

  it("opens the linked form and saves one queue entry through the audited wrapper with the mapped answers", async () => {
    rpc.mockResolvedValue({ data: { id: "q1", token: "T1", client_code: "MKC-1", client_type: "new", client_name: "Asha", mobile: "919876543210", status: "pending", created_at: "now", client_id: "c1", assigned_crm_name: null }, error: null });
    renderStart({ canManage: false, links: [queueLink] });
    fireEvent.click(await screen.findByRole("button", { name: "REGISTER CLIENT" }));
    expect(screen.getByRole("dialog", { name: "Register client" })).toBeTruthy();
    await submitForm!({ answers: { who: " Asha ", tel: "98765 43210" }, display: {} });
    expect(rpc).toHaveBeenCalledWith("register_walkin_entry_from_form", expect.objectContaining({
      p_submission_key: "key-1", p_client_name: "Asha", p_mobile: "+919876543210", p_branch_id: "branch-1",
      p_source: expect.objectContaining({ formFamilyId: "q-family", formTemplateId: "q-template", formVersion: 2, bindingVersionId: "qv" }),
    }));
    expect(registered).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Register client" })).toBeNull());
  });

  it("reuses the submission key after a lost connection so a retry cannot register twice", async () => {
    rpc.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ data: { id: "q1" }, error: null });
    renderStart({ canManage: false, links: [queueLink] });
    fireEvent.click(await screen.findByRole("button", { name: "REGISTER CLIENT" }));
    await expect(submitForm!({ answers: { who: "Asha", tel: "9876543210" }, display: {} })).rejects.toThrow(/will not be added twice/);
    await submitForm!({ answers: { who: "Asha", tel: "9876543210" }, display: {} });
    expect(rpc.mock.calls.map((call) => (call[1] as { p_submission_key: string }).p_submission_key)).toEqual(["key-1", "key-1"]);
  });

  it("refuses an invalid mobile number before saving", async () => {
    renderStart({ canManage: false, links: [queueLink] });
    fireEvent.click(await screen.findByRole("button", { name: "REGISTER CLIENT" }));
    await expect(submitForm!({ answers: { who: "Asha", tel: "123" }, display: {} })).rejects.toThrow(/10-digit/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("falls back to the standard form when the published form no longer fits, and tells form managers why", async () => {
    const broken = { ...queueLink, form: form({ name: "Queue", fields: [queueDefinition.fields[0]!] }, "q") };
    renderStart({ canManage: true, links: [broken] });
    expect(await screen.findByText("STANDARD QUEUE FORM")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("The question linked to Mobile number is no longer in the form.");
    fireEvent.click(screen.getByRole("button", { name: "Open CRM Form Settings" }));
    expect(await screen.findByRole("dialog", { name: "CRM Form Settings" })).toBeTruthy();
  });

  it("shows CRM FORM SETTINGS only to people who manage CRM forms", async () => {
    navigation.search = "";
    renderStart({ canManage: false, links: [] });
    await screen.findByRole("button", { name: /REGISTER LEAD/ });
    expect(screen.queryByRole("button", { name: "CRM FORM SETTINGS" })).toBeNull();
    cleanup();
    renderStart({ canManage: true, links: [] });
    fireEvent.click(await screen.findByRole("button", { name: "CRM FORM SETTINGS" }));
    expect(screen.getByRole("dialog", { name: "CRM Form Settings" })).toBeTruthy();
  });
});

describe("lead registration with a linked form", () => {
  beforeEach(() => { navigation.search = "?register=lead"; });

  it("keeps the standard lead form without a link", async () => {
    renderStart({ canManage: false, links: [queueLink] });
    expect(await screen.findByText("STANDARD LEAD FORM")).toBeTruthy();
  });

  it("saves the lead through save_crm_lead_from_form and still pushes it to Runo", async () => {
    rpc.mockResolvedValue({ data: { id: "lead-1", client_id: "c1", replayed: false }, error: null });
    runo.mockResolvedValue({ ok: true });
    renderStart({ canManage: false, links: [leadLink] });
    fireEvent.click(await screen.findByRole("button", { name: "OPEN LEAD FORM" }));
    await submitForm!({ answers: { nm: "Ravi", mob: "+6591234567", born: "1990-01-02" }, display: {} });
    expect(rpc).toHaveBeenCalledWith("save_crm_lead_from_form", expect.objectContaining({ p_phone: "+6591234567", p_name: "Ravi", p_fields: { dob: "1990-01-02" } }));
    expect(runo).toHaveBeenCalledWith("lead-1");
    expect(await screen.findByText("Lead saved and pushed to Runo.")).toBeTruthy();
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("explains a duplicate lead and keeps the form open with a fresh key", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
    renderStart({ canManage: false, links: [leadLink] });
    fireEvent.click(await screen.findByRole("button", { name: "OPEN LEAD FORM" }));
    await expect(submitForm!({ answers: { nm: "Ravi", mob: "9876543210" }, display: {} })).rejects.toThrow("A lead with this mobile number already exists.");
    expect(screen.getByRole("dialog", { name: "Register lead" })).toBeTruthy();
    expect(runo).not.toHaveBeenCalled();
  });
});
