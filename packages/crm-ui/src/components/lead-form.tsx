"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { PhoneNumberInput } from "@/components/phone-number-input";
import { composePhone, DEFAULT_COUNTRY_CODE, phoneError } from "@/lib/phone";
import { createClient } from "@/lib/supabase/client";
import { pushLeadToRuno } from "@/crm-port/phase4"; // crm-port: Runo push route -> crm-runo-push Edge Function

export type LeadField = { id: string; field_key: string; label: string; field_type: "text" | "number" | "dropdown" | "date" | "geo" | "file"; is_mandatory: boolean; is_hidden: boolean; display_order: number; is_runo_synced: boolean; runo_field_name: string | null; option_source: string | null };
export type LeadOption = { id: string; field_id: string; option_value: string; display_order: number; triggers_field_key: string | null };
function blank(value: string | undefined) { return !value?.trim(); }
function uniqueChoices(choices: string[]) {
  const seen = new Set<string>();
  return choices.filter(choice => { const key = choice.trim().toUpperCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}
function saveErrorMessage(code: string | undefined) {
  if (code === '23505') return 'A lead with this mobile number already exists.';
  if (code === '42501' || code === 'PGRST301') return 'Your CRM session cannot save this lead. Reload CRM and sign in again if needed. Your answers are still here.';
  if (code === '22023') return 'Check the required fields and select active dropdown choices. If choices changed, reload CRM before trying again.';
  if (code === '22007' || code === '22008') return 'Check the date of birth and anniversary dates before trying again.';
  if (code === '55000') return 'CRM dropdown choices are not ready. Ask an administrator to check Dropdown Master sync.';
  return 'Could not save the lead. Your answers are still here. Reload CRM if this continues.';
}

export function LeadForm({ fields, options, lookupOptions, actorId }: { fields: LeadField[]; options: LeadOption[]; lookupOptions: Record<string, string[]>; actorId: string }) {
  const router = useRouter(); const [values, setValues] = useState<Record<string, string>>({ country: "India" }); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const [saved, setSaved] = useState(false); const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY_CODE);

  const optionsByField = useMemo(() => Object.groupBy(options, ({ field_id }) => field_id), [options]);
  const conditionalKeys = useMemo(() => new Set(["source_of_lead", "type_of_calling", "name_of_exhibition", "exhibition_name", "invitation_offer_name"]), []);
  const visibleKeys = useMemo(() => { const shown = new Set(fields.filter((field) => !field.is_hidden && !conditionalKeys.has(field.field_key)).map((field) => field.field_key)); let changed = true; while (changed) { changed = false; for (const field of fields) { if (!shown.has(field.field_key) || field.is_hidden) continue; const option = (optionsByField[field.id] ?? []).find((item) => item.option_value.toUpperCase() === values[field.field_key]?.toUpperCase()); if (option?.triggers_field_key && !shown.has(option.triggers_field_key)) { shown.add(option.triggers_field_key); changed = true; } } } return shown; }, [conditionalKeys, fields, optionsByField, values]);
  const visibleFields = fields.filter((field) => visibleKeys.has(field.field_key) && !field.is_hidden).toSorted((a, b) => a.display_order - b.display_order);
  function setValue(key: string, value: string) { const next = { ...values, [key]: value }; const shown = new Set(fields.filter((field) => !field.is_hidden && !conditionalKeys.has(field.field_key)).map((field) => field.field_key)); let changed = true; while (changed) { changed = false; for (const field of fields) { if (!shown.has(field.field_key) || field.is_hidden) continue; const option = (optionsByField[field.id] ?? []).find((item) => item.option_value.toUpperCase() === next[field.field_key]?.toUpperCase()); if (option?.triggers_field_key && !shown.has(option.triggers_field_key)) { shown.add(option.triggers_field_key); changed = true; } } } for (const existingKey of Object.keys(next)) if (!shown.has(existingKey)) delete next[existingKey]; setValues(next); }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving || saved) return; setMessage("");
    const phoneProblem = phoneError(countryCode, values.mobile_no ?? "");
    const mobile = composePhone(countryCode, values.mobile_no ?? "");
    const missing = visibleFields.find(field => field.is_mandatory && blank(values[field.field_key]));
    if (phoneProblem || missing) {
      setMessage(phoneProblem ?? `${missing!.label} is required.`); return;
    }
    const fieldValues = Object.fromEntries(Object.entries(values).filter(([key, value]) => key !== "mobile_no" && key !== "name" && visibleKeys.has(key) && !blank(value)));
    setSaving(true);
    try {
      const {data,error} = await createClient().rpc("save_crm_lead", {p_phone:mobile,p_name:values.name?.trim() || "",p_fields:fieldValues});
      if (error || !data) {
        setMessage(saveErrorMessage(error?.code)); return;
      }
      setSaved(true);
      try {
        const response = await pushLeadToRuno(data.id);
        setMessage(response.ok ? "Lead saved and pushed to Runo." : "Lead saved locally. Runo sync not yet configured.");
      } catch { setMessage("Lead saved. Runo push could not complete."); }
      router.refresh();
    } catch { setMessage("Could not confirm the lead save. Check the client database before retrying."); }
    finally { setSaving(false); }
  }
  return <section className="mt-6 max-w-4xl rounded-xl border bg-white p-5"><form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>{visibleFields.map((field) => { const choices = uniqueChoices(lookupOptions[field.option_source ?? field.field_key] ?? []); if (field.field_key === "mobile_no") return <div key={field.id}><PhoneNumberInput label={`${field.label}${field.is_mandatory ? " *" : ""}`} ariaLabel={field.label} countryCode={countryCode} number={values.mobile_no ?? ""} onCountryCodeChange={setCountryCode} onNumberChange={(value) => setValue("mobile_no", value)} inputClassName="mt-1 block w-full rounded border p-2" /></div>; if (field.field_type === "file") return <p key={field.id} className="md:col-span-2 rounded bg-amber-50 p-3 text-sm text-amber-900">{field.label}: file fields require a lead-document storage policy and are not enabled yet.</p>; return <label className="text-sm" key={field.id}>{field.label}{field.is_mandatory ? " *" : ""}{field.field_type === "dropdown" ? <select aria-label={field.label} className="mt-1 block w-full rounded border p-2" value={values[field.field_key] ?? ""} onChange={(event) => setValue(field.field_key, event.target.value)}><option value="">Select {field.label}</option>{!choices.length ? <option disabled value="__empty">No active choices. Update JewelOS Dropdown Master.</option> : null}{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select> : <input aria-label={field.label} className="mt-1 block w-full rounded border p-2" type={field.field_type === "date" ? "date" : "text"} inputMode={field.field_key === "mobile_no" || field.field_type === "number" ? "numeric" : undefined} value={values[field.field_key] ?? ""} onChange={(event) => setValue(field.field_key, event.target.value)} />}</label>; })}<div className="md:col-span-2"><button disabled={saving || saved} className="rounded bg-amber-800 px-4 py-2 font-medium text-white disabled:opacity-50">{saving ? "Saving..." : saved ? "Lead saved" : "Save lead"}</button>{saved?<button type="button" className="ml-3 rounded border px-4 py-2" onClick={()=>{setValues({country:'India'});setSaved(false);setMessage('');}}>Register another lead</button>:null}{message ? <p role="status" className="mt-3 text-sm text-stone-700">{message}</p> : null}</div></form></section>;

}
