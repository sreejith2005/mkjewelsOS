// @vitest-environment jsdom
// CRM Form Settings (owner request 2026-11-03): a Super Admin links a published Form Builder form
// to a CRM registration and its questions to CRM answers; the form opens in a JewelOS dialog.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CRM_QUEUE_TARGETS, crmLeadTargets } from "@jewelos/core";

const db = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = { form_templates: [], form_fields: [] };
  const rpc = vi.fn();
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    let single = false;
    const result = () => {
      const rows = (tables[table] ?? []).filter((row) => filters.every(([column, value]) => row[column] === value));
      return Promise.resolve(single ? { data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } } : { data: rows, error: null });
    };
    const chain = {
      select: () => chain, order: () => chain, limit: () => chain,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return chain; },
      single: () => { single = true; return chain; },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => result().then(resolve, reject),
    };
    return chain;
  };
  return { tables, rpc, supabase: { from, rpc } };
});
const formsApi = vi.hoisted(() => ({ saveDraft: vi.fn(), publishForm: vi.fn(), setFormLibraryVisibility: vi.fn() }));
vi.mock("@jewelos/api-client", () => ({ supabase: db.supabase }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/features/forms/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/forms/api")>()),
  ...formsApi,
  loadFormDynamicOptions: vi.fn(async () => ({ users: [], branches: [], departments: [], masters: [{ masterType: "crm_source", value: "insta", label: "Instagram" }] })),
}));

import { CrmFormSettingsDialog, LinkedFormDialog, loadCrmFormLinks } from "./crmForms";

const template = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, family_id: `${id}-family`, name, version: 1, lifecycle: "published", library_visible: false, description: null, record_name_field_key: null, sections: [], permissions: { roles: [] }, ...extra });
const field = (formId: string, key: string, label: string, type: string, sort: number, required = true) => ({ id: `${formId}-${key}`, form_template_id: formId, field_key: key, field_name: label, field_type: type, sort_order: sort, is_required: required, is_shown: true, is_editable: true, options: null, option_source: null, dropdown_master_type: null, conditional_logic: null, branch_logic: null, validation: { width: "half" }, placeholder: null, helper_text: null, group_name: null });
const targets = { queue: CRM_QUEUE_TARGETS, lead: crmLeadTargets([
  { field_key: "name", label: "Name", field_type: "text", is_mandatory: true, is_hidden: false, display_order: 1, option_source: null },
  { field_key: "mobile_no", label: "Mobile no", field_type: "text", is_mandatory: true, is_hidden: false, display_order: 2, option_source: null },
  { field_key: "source_of_lead", label: "Source of lead", field_type: "dropdown", is_mandatory: false, is_hidden: false, display_order: 3, option_source: "lookup_source_of_leads" },
]) };

beforeEach(() => {
  db.tables.form_templates = [template("f1", "Front desk queue"), template("f2", "Visible survey", { library_visible: true })];
  db.tables.form_fields = [field("f1", "customer", "Client name", "text", 0), field("f1", "phone", "Mobile number", "phone", 1), field("f2", "q", "Anything else?", "textarea", 0, false)];
  db.rpc.mockReset(); Object.values(formsApi).forEach((mock) => mock.mockReset());
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderSettings(links = { canManage: true, links: [] as never[] }) {
  const onSaved = vi.fn(); const onEditForm = vi.fn();
  render(<CrmFormSettingsDialog links={links} onClose={vi.fn()} onEditForm={onEditForm} onSaved={onSaved} targets={targets} />);
  return { onSaved, onEditForm, dialog: screen.getByRole("dialog", { name: "CRM Form Settings" }) };
}

describe("CRM Form Settings", () => {
  it("starts on the standard CRM form and links a published form with suggested questions", async () => {
    db.rpc.mockImplementation(async (name: string) => name === "save_crm_form_binding" ? { data: { versionId: "v1" }, error: null } : { data: { canManage: true, bindings: [] }, error: null });
    const { onSaved, dialog } = renderSettings();
    expect(within(dialog).getByText("Standard CRM form")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("option", { name: "Front desk queue (version 1)" })).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox", { name: "Published form" }), { target: { value: "f1-family" } });
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Question for Mobile number" }) as HTMLSelectElement).value).toBe("phone"));
    expect((screen.getByRole("combobox", { name: "Question for Client name" }) as HTMLSelectElement).value).toBe("customer");
    expect(screen.getByText(/Every CRM answer is linked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and use this form" }));
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("save_crm_form_binding", { p_purpose: "queue", p_form_family_id: "f1-family", p_field_map: { client_name: "customer", mobile: "phone" } }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("blocks saving until every required CRM answer is linked, and explains why", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByRole("option", { name: "Visible survey (version 1)" })).toBeTruthy());
    fireEvent.change(screen.getByRole("combobox", { name: "Published form" }), { target: { value: "f2-family" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Save and use this form" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "Save and use this form" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Validate mapping" }));
    expect(screen.getByText("Fix these before CRM can use the form:")).toBeTruthy();
    expect(screen.getAllByText("Choose the question for Mobile number.").length).toBeGreaterThan(0);
    expect(screen.getByText(/also listed in Forms Library/)).toBeTruthy();
  });

  it("creates a starter form from the CRM's own answers, hidden from Forms Library, and links it", async () => {
    formsApi.saveDraft.mockImplementation(async () => {
      db.tables.form_templates.push(template("f3", "CRM lead registration"));
      db.tables.form_fields.push(field("f3", "name", "Name", "text", 0), field("f3", "mobile_no", "Mobile no", "phone", 1), field("f3", "source_of_lead", "Source of lead", "select", 2, false));
      return "f3";
    });
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Lead" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Front desk queue (version 1)" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Create a starter form/ }));
    await waitFor(() => expect(formsApi.publishForm).toHaveBeenCalledWith("f3"));
    expect(formsApi.setFormLibraryVisibility).toHaveBeenCalledWith("f3", false);
    const [, payload, fields] = formsApi.saveDraft.mock.calls[0] as [null, { name: string; permissions: { roles: string[] } }, Array<{ key: string; type: string; optionSource?: unknown; validation?: { width?: string } }>];
    expect(payload.name).toBe("CRM lead registration");
    expect(payload.permissions.roles.length).toBeGreaterThan(0);
    expect(fields.map((item) => [item.key, item.type, item.validation?.width])).toEqual([["name", "text", "half"], ["mobile_no", "phone", "half"], ["source_of_lead", "select", "half"]]);
    expect(fields[2]!.optionSource).toEqual({ kind: "master", masterType: "crm_source" });
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Question for Source of lead" }) as HTMLSelectElement).value).toBe("source_of_lead"));
  });

  it("keeps the walk-in visit on the standard form for now", () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /Walk-in visit/ }));
    expect(screen.getByText(/walk-in visit form is next/)).toBeTruthy();
  });

  it("returns to the standard CRM form on request", async () => {
    const link = { purpose: "queue" as const, versionId: "v1", fieldMap: { client_name: "customer", mobile: "phone" }, savedAt: "2026-11-03T10:00:00Z", savedBy: "Owner",
      form: { templateId: "f1", familyId: "f1-family", version: 1, name: "Front desk queue", definition: { name: "Front desk queue", fields: [
        { key: "customer", label: "Client name", type: "text" as const, sortOrder: 0, required: true }, { key: "phone", label: "Mobile number", type: "phone" as const, sortOrder: 1, required: true }] } } };
    db.rpc.mockResolvedValue({ data: { canManage: true, bindings: [] }, error: null });
    renderSettings({ canManage: true, links: [link] as never[] });
    expect(screen.getByText("Active in CRM")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Use the standard CRM form" })[0]!);
    await waitFor(() => expect(db.rpc).toHaveBeenCalledWith("clear_crm_form_binding", { p_purpose: "queue", p_expected_version_id: "v1" }));
  });
});

describe("linked CRM forms", () => {
  it("reads the active links with their published questions", async () => {
    db.rpc.mockResolvedValue({ data: { canManage: false, bindings: [{ purpose: "queue", versionId: "v1", fieldMap: { client_name: "customer" }, savedAt: "x", savedBy: null,
      form: { template: template("f1", "Front desk queue"), fields: [field("f1", "customer", "Client name", "text", 0)] } }] }, error: null });
    const links = await loadCrmFormLinks();
    expect(links.canManage).toBe(false);
    expect(links.links[0]!.form).toMatchObject({ templateId: "f1", familyId: "f1-family", version: 1 });
    expect(links.links[0]!.form!.definition.fields[0]).toMatchObject({ key: "customer", type: "text", validation: { width: "half" } });
  });

  it("opens the form in a dialog and hands CRM the answers with the labels people saw", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<LinkedFormDialog form={{ templateId: "f1", familyId: "f1-family", version: 1, name: "Lead", definition: { name: "Lead", fields: [
      { key: "who", label: "Name", type: "text", sortOrder: 0, required: true, validation: { width: "half" } },
      { key: "src", label: "Source", type: "select", sortOrder: 1, optionSource: { kind: "master", masterType: "crm_source" }, validation: { width: "half" } },
    ] } }} onClose={vi.fn()} onSubmit={onSubmit} title="Register lead" />);
    const dialog = screen.getByRole("dialog", { name: "Register lead" });
    await waitFor(() => expect(within(dialog).getByRole("option", { name: "Instagram" })).toBeTruthy());
    expect(dialog.querySelector(".md\\:col-span-3")).toBeTruthy();
    fireEvent.change(within(dialog).getAllByRole("textbox")[0]!, { target: { value: "Ravi" } });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "insta" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Register lead" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ answers: { who: "Ravi", src: "insta" }, display: { who: "Ravi", src: "Instagram" } }));
  });
});
