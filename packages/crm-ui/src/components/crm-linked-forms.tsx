"use client";
// crm-port: client queue and lead registration through a Form Builder form linked in CRM Form
// Settings (owner request 2026-11-03). The question layout comes from the Form Builder; the save
// goes through the CRM's audited RPCs (register_walkin_entry / save_crm_lead) via their
// *_from_form wrappers, which also record the form version and answers. Without a usable link the
// standard CRM form stays in place.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { checkCrmFormBinding, crmAnswersFromForm, type CrmFormBindingIssue, type CrmFormPurpose, type CrmFormTarget } from "@jewelos/core";

import { pushLeadToRuno } from "@/crm-port/phase4"; // crm-port: Runo push route -> crm-runo-push Edge Function
import { useCrmFormsHost, type CrmFormLink, type CrmFormLinks, type CrmFormsHost, type CrmLeadSetup, type CrmSubmittedForm } from "@/crm-port/forms-host";
import { composePhone, DEFAULT_COUNTRY_CODE, phoneError } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/lib/supabase/crm-project.types";

export const CRM_FORM_LINKS_QUERY = ["crm-form-links"] as const;

/** The last links read, kept on this device so linked forms still open when the network drops (form layouts only, no customer data). */
const LINKS_CACHE_KEY = "jewelos.crm.form-links.v1";
async function loadLinksWithOfflineCopy(host: CrmFormsHost): Promise<CrmFormLinks> {
  try {
    const links = await host.loadLinks();
    try { window.localStorage.setItem(LINKS_CACHE_KEY, JSON.stringify(links)); } catch { /* no room: the online links still work */ }
    return links;
  } catch (caught) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      try {
        const stored = window.localStorage.getItem(LINKS_CACHE_KEY);
        // Written above from a CrmFormLinks value on this device.
        if (stored) return JSON.parse(stored) as CrmFormLinks;
      } catch { /* unreadable copy: report the original problem */ }
    }
    throw caught;
  }
}

/** The active links, or null while loading, when the host has none, or when they cannot be read (the standard forms then stay). */
export function useCrmFormLinks(): { host: CrmFormsHost | null; links: CrmFormLinks | null; loading: boolean } {
  const host = useCrmFormsHost();
  const query = useQuery({ queryKey: CRM_FORM_LINKS_QUERY, queryFn: () => loadLinksWithOfflineCopy(host!), enabled: host !== null, staleTime: 30_000, retry: 1 });
  return { host, links: query.data ?? null, loading: host !== null && query.isPending };
}

export type UsableLink = { link: CrmFormLink; issues: readonly CrmFormBindingIssue[] };

/** The link for a purpose and whether the current published form still satisfies it. */
export function linkFor(links: CrmFormLinks | null, purpose: CrmFormPurpose, targets: readonly CrmFormTarget[]): UsableLink | null {
  const link = links?.links.find((item) => item.purpose === purpose);
  if (!link) return null;
  if (!link.form) return { link, issues: [{ message: "The linked form has no published version." }] };
  return { link, issues: checkCrmFormBinding(link.form.definition, link.fieldMap, targets) };
}

/** Shown to form managers when CRM fell back to the standard form. */
export function LinkNeedsAttention({ usable, canManage, onOpenSettings }: { usable: UsableLink | null; canManage: boolean; onOpenSettings?: (() => void) | undefined }) {
  if (!usable || !usable.issues.length || !canManage) return null;
  return <p role="status" className="mt-4 rounded bg-amber-50 p-3 text-sm text-amber-900">CRM is showing its standard form because the linked form {usable.link.form ? `"${usable.link.form.name}"` : ""} needs attention: {usable.issues[0]!.message} {onOpenSettings ? <button type="button" className="font-medium underline" onClick={onOpenSettings}>Open CRM Form Settings</button> : "Fix it in REGISTRATION → CRM FORM SETTINGS."}</p>;
}

/** A browser-generated key per form opening, so a retried save cannot register the client twice. */
function useSubmissionKey() {
  const key = useRef<string>(crypto.randomUUID());
  return { current: () => key.current, renew: () => { key.current = crypto.randomUUID(); } };
}

function sourceOf(link: CrmFormLink, submitted: CrmSubmittedForm): Json {
  const form = link.form!;
  // Form answers are plain JSON values (text, numbers, true/false, lists of text); the round trip
  // drops undefined entries so the payload is exactly what the database stores.
  const answers = JSON.parse(JSON.stringify({ answers: submitted.answers, display: submitted.display })) as Json;
  return { formFamilyId: form.familyId, formTemplateId: form.templateId, formVersion: form.version, bindingVersionId: link.versionId, answers };
}

function mobileFrom(raw: string | undefined): string {
  const typed = raw ?? "";
  const problem = phoneError(DEFAULT_COUNTRY_CODE, typed);
  if (problem) throw new Error(`${problem} Numbers outside India start with + and the country code.`);
  return composePhone(DEFAULT_COUNTRY_CODE, typed);
}

type RpcError = { code?: string; message?: string } | null;
/** A server answer means nothing was saved (the transaction rolled back), so the next try uses a new key. */
function definitive(error: RpcError) { return Boolean(error?.code); }

export type RegisteredEntry = { id: string; token: string; client_name: string; mobile: string; assigned_crm_name: string | null; status: string; created_at: string; client_id: string | null; client_is_new?: boolean; branch_id?: string; client_type?: string; client_code?: string };

/** REGISTER CLIENT ENTRY with a linked queue form: the branch stays a CRM choice, the questions come from the form. */
export function LinkedQueueRegistration({ host, link, branchSelect, branch, onRegistered }: { host: CrmFormsHost; link: CrmFormLink; branchSelect: ReactNode; branch: string; onRegistered: (saved: RegisteredEntry) => void }) {
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const key = useSubmissionKey();
  async function submit(submitted: CrmSubmittedForm) {
    const answers = crmAnswersFromForm(link.fieldMap, submitted.answers, submitted.display);
    if (!branch) throw new Error("Choose the branch in CRM before registering.");
    if (!answers.client_name) throw new Error("Enter the client name.");
    const mobile = mobileFrom(answers.mobile);
    let response: { data: unknown; error: RpcError };
    try {
      response = await createClient().rpc("register_walkin_entry_from_form", { p_submission_key: key.current(), p_client_name: answers.client_name, p_mobile: mobile, p_branch_id: branch, p_source: sourceOf(link, submitted) });
    } catch { throw new Error("Could not confirm the registration. Check your connection and press Register again: the client will not be added twice."); }
    const { data, error } = response;
    if (error || !data || typeof data !== "object") {
      if (definitive(error)) key.renew();
      throw new Error(error?.code === "42501" ? "Your CRM session cannot register clients. Reload CRM and try again." : error?.code === "23505" ? "This registration was already saved with different answers. Close the form and check the queue." : "Could not register the queue entry. Check the selected branch and the answers.");
    }
    key.renew();
    setOpen(false);
    onRegistered(data as RegisteredEntry);
  }
  return <div className="mt-4 grid gap-4 md:grid-cols-3">
    {branchSelect}
    <div className="flex flex-wrap items-end gap-3 md:col-span-2">
      <button type="button" className="rounded bg-amber-800 px-4 py-2 font-medium text-white" onClick={() => { if (!branch) { setHint("Choose the branch first."); return; } setHint(""); setOpen(true); }}>REGISTER CLIENT</button>
      {hint ? <p role="status" className="text-sm text-amber-900">{hint}</p> : null}
    </div>
    {open ? host.renderForm({ title: "Register client", description: link.form!.name, form: link.form!, onClose: () => setOpen(false), onSubmit: submit }) : null}
  </div>;
}

function leadSaveError(code: string | undefined) {
  if (code === "23505") return "A lead with this mobile number already exists.";
  if (code === "42501" || code === "PGRST301") return "Your CRM session cannot save this lead. Reload CRM and sign in again if needed.";
  if (code === "22023") return "Check the answers: CRM needs every required lead detail and active Dropdown Master choices.";
  if (code === "22007" || code === "22008") return "Check the dates before trying again.";
  if (code === "55000") return "CRM dropdown choices are not ready. Ask an administrator to check Dropdown Master sync.";
  return "Could not save the lead. Your answers are still here.";
}

/** Lead registration with a linked lead form; keeps the Runo push and lead continuity of the standard form. */
export function LinkedLeadRegistration({ host, link, onSaved }: { host: CrmFormsHost; link: CrmFormLink; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const key = useSubmissionKey();
  async function submit(submitted: CrmSubmittedForm) {
    const answers = crmAnswersFromForm(link.fieldMap, submitted.answers, submitted.display);
    const phone = mobileFrom(answers.mobile_no);
    const { name = "", mobile_no: _mobile, ...fields } = answers;
    let response: { data: unknown; error: RpcError };
    try {
      response = await createClient().rpc("save_crm_lead_from_form", { p_submission_key: key.current(), p_phone: phone, p_name: name, p_fields: fields, p_source: sourceOf(link, submitted) });
    } catch { throw new Error("Could not confirm the lead save. Check your connection and press Submit again: the lead will not be saved twice."); }
    const { data, error } = response;
    const saved = data && typeof data === "object" && "id" in data ? data as { id: string; replayed?: boolean } : null;
    if (error || !saved) { if (definitive(error)) key.renew(); throw new Error(leadSaveError(error?.code)); }
    key.renew();
    setOpen(false);
    setMessage("Lead saved. Sending it to Runo…");
    try {
      const response = await pushLeadToRuno(saved.id);
      setMessage(response.ok ? "Lead saved and pushed to Runo." : "Lead saved locally. Runo sync not yet configured.");
    } catch { setMessage("Lead saved. Runo push could not complete."); }
    onSaved();
  }
  return <section className="mt-6 max-w-4xl rounded-xl border bg-white p-5">
    <h2 className="text-lg font-semibold">REGISTER LEAD</h2>
    <p className="mt-2 text-sm text-stone-600">For Instagram, WhatsApp, calling, exhibitions, referrals and other remote enquiries.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3"><button type="button" className="rounded bg-amber-800 px-4 py-2 font-medium text-white" onClick={() => { setMessage(""); setOpen(true); }}>{message ? "REGISTER ANOTHER LEAD" : "OPEN LEAD FORM"}</button></div>
    {message ? <p role="status" className="mt-3 text-sm text-green-800">{message}</p> : null}
    {open ? host.renderForm({ title: "Register lead", description: link.form!.name, form: link.form!, onClose: () => setOpen(false), onSubmit: submit }) : null}
  </section>;
}

/** CRM FORM SETTINGS, for people allowed to manage CRM forms. */
export function CrmFormSettingsButton({ host, links, targets, leadSetup, openOnMount = false }: { host: CrmFormsHost; links: CrmFormLinks; targets: Readonly<Record<"queue" | "lead" | "walkin", readonly CrmFormTarget[]>>; leadSetup: CrmLeadSetup; openOnMount?: boolean }) {
  const [open, setOpen] = useState(openOnMount);
  const queryClient = useQueryClient();
  if (!links.canManage) return null;
  return <>
    <button type="button" className="crm-form-settings-button" onClick={() => setOpen(true)}>CRM FORM SETTINGS</button>
    {open ? host.renderSettings({ links, targets, leadSetup, onClose: () => setOpen(false), onSaved: () => { void queryClient.invalidateQueries({ queryKey: CRM_FORM_LINKS_QUERY }); } }) : null}
  </>;
}
