"use client";
// crm-port: the walk-in visit through a Form Builder form linked in CRM Form Settings (owner
// request 2026-11-03). It opens from the client's queue entry with the same prefill as the
// standard walk-in form, gives the form CRM's lookups (client history by mobile, address by
// pincode), the branch's CRM people and salespeople, and uploads to CRM documents storage, then
// saves through submit_walkin_visit_from_form, which calls submit_walkin_visit unchanged.
import { useMemo, useRef, useState } from "react";
import { crmLinkedQuestions, type FormCrmFile, type FormCrmServices } from "@jewelos/core";

import { walkInSubmitErrorMessage, istDateTimeLocal } from "@/components/walk-in-form";
import type { CrmFormLink, CrmFormsHost, CrmSubmittedForm } from "@/crm-port/forms-host";
import { clientProfileAutofill, lookupClientByPhone } from "@/lib/client-phone-lookup";
import { composePhone, DEFAULT_COUNTRY_CODE, formatPhone, phoneKey, splitPhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";
import type { Client } from "@/lib/supabase/app-types";
import { WALKIN_WEDDING_MONTHS } from "@/lib/walkin-profile-defaults";
import { walkinPayloadFromForm } from "@/lib/walkin-form-payload";
import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

type Queue = { id: string; client_name: string; mobile: string; branch_id: string; assigned_crm_name: string | null; client_id: string | null; client_is_new?: boolean; status: string };
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);

/** A stored phone as typed in the form: the national number for India, otherwise "+<code><number>". */
function typedPhone(stored: string | null | undefined): string {
  const { countryCode, number } = splitPhone(stored);
  return !number ? "" : countryCode === DEFAULT_COUNTRY_CODE ? number : `+${countryCode}${number}`;
}
const monthName = (value: string | undefined) => WALKIN_WEDDING_MONTHS[Number(value) - 1] ?? value ?? "";

export function LinkedWalkinVisit({ host, link, queue, client, profileName, crmByBranch, salespeopleByBranch }: {
  host: CrmFormsHost; link: CrmFormLink; queue: Queue; client: Client | null; profileName: string;
  crmByBranch: Record<string, string[]>; salespeopleByBranch: Record<string, Array<{ id: string; name: string }>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [saved, setSaved] = useState(false);
  const anchorClientId = client?.client_id || queue.client_id || "";
  const anchorPhone = useMemo(() => anchorClientId ? phoneKey(client?.primary_phone ? `+${client.primary_phone}` : composePhone(splitPhone(queue.mobile).countryCode, splitPhone(queue.mobile).number)) : null, [anchorClientId, client?.primary_phone, queue.mobile]);
  // The client this visit is for: the queue's, or whoever the mobile number lookup finds.
  const resolved = useRef<{ clientId: string; clientType: "new" | "existing" }>({ clientId: anchorClientId, clientType: queue.client_is_new || !anchorClientId ? "new" : "existing" });
  const proposedClientId = useRef(anchorClientId || crypto.randomUUID());
  const proposedTimelineId = useRef(crypto.randomUUID());
  const submissionKey = useRef(crypto.randomUUID());
  const salespeople = salespeopleByBranch[queue.branch_id] ?? [];
  const question = (target: string) => crmLinkedQuestions(link.fieldMap, target)[0];

  /** Target -> text, re-keyed to the first question linked to each target. */
  const byQuestion = (texts: Readonly<Record<string, string | null | undefined>>) => Object.fromEntries(Object.entries(texts).flatMap(([target, text]) => {
    const key = question(target);
    return key && text?.toString().trim() ? [[key, text.toString()]] : [];
  }));

  const initialText = useMemo(() => {
    const defaults = client?.walkin_defaults;
    return byQuestion({
      event_date: istDateTimeLocal(), primary_name: client?.primary_name ?? queue.client_name, primary_phone: typedPhone(client?.primary_phone ?? queue.mobile),
      source_of_lead: "Walk-in", crm_name: queue.assigned_crm_name ?? profileName, billing_phone: formatPhone(client?.billing_phone) === formatPhone(client?.primary_phone) ? "" : typedPhone(client?.billing_phone),
      gender: client?.gender?.toUpperCase(), country: client?.country ?? "India", state: client?.state, city: client?.city, city_other: client?.city_other, pincode: client?.pincode, address: client?.address,
      community: client?.community, community_other: client?.community_other, dob: client?.dob, anniversary: client?.anniversary,
      occupation: defaults?.occupation, occupation_other: defaults?.occupation_other, bridal_or_non_bridal: defaults?.bridal_or_non_bridal,
      wedding_month: monthName(defaults?.wedding_month), wedding_year: defaults?.wedding_year, communication_preference: client?.communication_preference,
      beverage: client?.beverage, sugar: client?.sugar, snack: client?.snack, beverage_other: defaults?.beverage_other, sugar_other: defaults?.sugar_other, snack_other: defaults?.snack_other,
      next_visit_date: client?.next_visit_date, client_potential_category: client?.client_potential_category, high_potential_reason: client?.high_potential_reason,
    });
  // The prefill is fixed when the form opens, like the standard form's initial values.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const services = useMemo<FormCrmServices>(() => ({
    // The questions the walk-in link ties to Salesperson / CRM get the branch's lists automatically.
    choices: (fieldKey) => {
      const linkedTo = (target: string) => crmLinkedQuestions(link.fieldMap, target).includes(fieldKey);
      if (linkedTo("salesperson") || linkedTo("salesperson_handled")) return salespeople.map((person) => person.name);
      if (linkedTo("crm_name")) return crmByBranch[queue.branch_id] ?? [];
      return null;
    },
    lookup: async (kind, value) => {
      if (kind === "pincode") {
        const { data } = await createClient().from("lookup_pincodes").select("city,state,country").eq("pincode", value.trim()).eq("active", true).maybeSingle();
        if (!data) return null;
        const address = { city: data.city, state: data.state, country: data.country };
        return { details: address, byQuestion: byQuestion(address) };
      }
      const typed = composePhone(DEFAULT_COUNTRY_CODE, value);
      // While the mobile is still the queue client's own, the visit stays with that client.
      if (anchorPhone && phoneKey(typed) === anchorPhone) { resolved.current = { clientId: anchorClientId, clientType: queue.client_is_new ? "new" : "existing" }; proposedClientId.current = anchorClientId; return null; }
      const matched = await lookupClientByPhone(typed);
      if (!matched) { if (!anchorClientId) resolved.current = { clientId: "", clientType: "new" }; return null; }
      resolved.current = { clientId: matched.client_id, clientType: queue.client_is_new && matched.client_id === queue.client_id ? "new" : "existing" };
      proposedClientId.current = matched.client_id;
      const filled = clientProfileAutofill(matched) as Record<string, string>;
      const details = { ...filled, wedding_month: monthName(filled.wedding_month) };
      return { details, byQuestion: byQuestion(details) };
    },
    upload: async (fieldKey, file, { video }) => {
      const type = file.type.toLowerCase();
      if (!IMAGE_MIME.has(type) && !(video && VIDEO_MIME.has(type))) throw new Error("This file type is not allowed.");
      if (file.size > 10 * 1024 * 1024) throw new Error("File must be 10MB or smaller.");
      const clientId = resolved.current.clientId || proposedClientId.current;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${clientId}/${proposedTimelineId.current}/${crypto.randomUUID()}_${safeName}`;
      const { error } = await createClient().storage.from("crm-documents").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(`Upload failed for ${fieldKey === "remark_photos" ? "the photo" : "the proof"}. Try again.`);
      return { path, clientId, fileName: file.name, mimeType: file.type };
    },
    remove: async (file: FormCrmFile) => { await createClient().storage.from("crm-documents").remove([file.path]); },
  // Services read refs for the live client; the branch lists are fixed for this queue entry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [anchorClientId, anchorPhone, queue.branch_id, queue.client_id, queue.client_is_new]);

  async function submit(submitted: CrmSubmittedForm) {
    const context = { queueId: queue.id, branchId: queue.branch_id, clientId: resolved.current.clientId, clientType: resolved.current.clientType, proposedClientId: proposedClientId.current, proposedTimelineId: proposedTimelineId.current, salespeople };
    const { payload, files } = walkinPayloadFromForm(link.fieldMap, submitted, context);
    const targetClientId = context.clientId || proposedClientId.current;
    if (files.some((file) => file.clientId !== targetClientId)) throw new Error("The mobile number changed after a photo was uploaded. Remove and add that photo again before submitting.");
    const form = link.form!;
    const source = JSON.parse(JSON.stringify({ formFamilyId: form.familyId, formTemplateId: form.templateId, formVersion: form.version, bindingVersionId: link.versionId, answers: { answers: submitted.answers, display: submitted.display } }));
    let response: { data: unknown; error: { code?: string; message?: string } | null };
    try {
      response = await createClient().rpc("submit_walkin_visit_from_form", { p_submission_key: submissionKey.current, p_payload: JSON.parse(JSON.stringify(payload)), p_source: source });
    } catch { throw new Error("Could not confirm the visit. Check your connection and press Submit again: the visit will not be saved twice."); }
    const { data, error } = response;
    const result = data && typeof data === "object" && "client_id" in data ? data as { client_id: string } : null;
    if (error || !result) {
      if (error?.code) submissionKey.current = crypto.randomUUID();
      throw new Error(`${walkInSubmitErrorMessage(error)}${files.length ? " Uploaded photos were kept so you do not need to add them again." : ""}`);
    }
    setSaved(true);
    setOpen(false);
    const primaryName = (submitted.display[question("primary_name") ?? ""] ?? queue.client_name).trim();
    router.push(`/queue?branch=${encodeURIComponent(queue.branch_id)}&completed=${encodeURIComponent(primaryName)}&completedClientId=${encodeURIComponent(result.client_id)}`);
  }

  return <section className="mt-6 max-w-4xl rounded-xl border bg-white p-5">
    <h2 className="text-lg font-semibold">CLIENT DETAILS {resolved.current.clientType === "existing" ? <span className="text-sm font-normal text-green-700">Existing client detected</span> : <span className="text-sm font-normal text-amber-700">New client</span>}</h2>
    <p className="mt-2 text-sm text-stone-600">{queue.client_name} · {formatPhone(queue.mobile)}</p>
    <div className="mt-4 flex flex-wrap items-end gap-3"><button type="button" disabled={saved} className="rounded bg-amber-800 px-4 py-2 font-medium text-white disabled:opacity-50" onClick={() => setOpen(true)}>{saved ? "Visit saved" : "OPEN WALK-IN FORM"}</button></div>
    {open && !saved ? host.renderForm({ title: "Walk-in visit form", description: `${link.form!.name} · ${queue.client_name}`, form: link.form!, initialText, crm: services, submitLabel: "Submit complete visit", onClose: () => setOpen(false), onSubmit: submit }) : null}
  </section>;
}
