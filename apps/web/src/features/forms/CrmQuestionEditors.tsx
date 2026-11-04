// Form Builder editors for the CRM question types (owner request 2026-11-03): a repeating group's
// "How many?" question and row questions, and a CRM photo's upload settings. Client lookups by
// phone number and pincode need no settings: every form does them (2026-11-04).
import { Plus, Trash2 } from "lucide-react";
import type { FormCrmBehaviour, FormFieldDefinition, FormRepeatConfig, FormRepeatSubfield } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import type { MasterOption } from "@/features/dropdowns/api";
import { titleCase } from "@/lib/format";

const SUB_TYPES: ReadonlyArray<{ value: FormRepeatSubfield["type"]; label: string }> = [{ value: "text", label: "Short text" }, { value: "phone", label: "Phone number" }, { value: "select", label: "Dropdown" }];
const keyFor = (label: string, used: readonly string[]) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([^a-z])/, "q_$1").slice(0, 40) || "answer";
  let key = base;
  for (let round = 2; used.includes(key); round += 1) key = `${base}_${round}`;
  return key;
};

/** "How many?" wording and range, then the questions asked for each person or item. */
export function RepeatEditor({ field, masterOptions, onChange }: { field: FormFieldDefinition; masterOptions: readonly MasterOption[]; onChange: (repeat: FormRepeatConfig) => void }) {
  const config: FormRepeatConfig = field.validation?.repeat ?? { countLabel: "How many?", min: 0, max: 10, fields: [] };
  const lists = [...new Set(masterOptions.map((item) => item.master_type))].sort();
  const patch = (next: Partial<FormRepeatConfig>) => onChange({ ...config, ...next });
  const patchSub = (index: number, next: Partial<FormRepeatSubfield>) => patch({ fields: config.fields.map((sub, at) => at === index ? { ...sub, ...next } : sub) });
  return <div className="grid gap-3 rounded-lg border border-gold/15 bg-obsidian/30 p-3 sm:col-span-2">
    <p className="text-sm font-semibold text-champagne">Repeating group</p>
    <p className="-mt-2 text-xs text-soft-grey">People first choose how many, then answer the questions below once for each. Works in CRM forms.</p>
    <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem]">
      <Field label="&quot;How many?&quot; question"><input className="field" onChange={(event) => patch({ countLabel: event.target.value })} value={config.countLabel} /></Field>
      <Field label="From"><input className="field" inputMode="numeric" max={20} min={0} onChange={(event) => patch({ min: Math.max(0, Math.min(20, Number(event.target.value) || 0)) })} type="number" value={config.min} /></Field>
      <Field label="Up to"><input className="field" inputMode="numeric" max={20} min={1} onChange={(event) => patch({ max: Math.max(1, Math.min(20, Number(event.target.value) || 1)) })} type="number" value={config.max} /></Field>
    </div>
    <label className="text-sm text-champagne"><input checked={config.allowNa === true} onChange={(event) => patch({ allowNa: event.target.checked || undefined })} type="checkbox" /> Also offer &quot;NA&quot;</label>
    <ul className="grid gap-2">{config.fields.map((sub, index) => <li className="grid gap-2 rounded-lg border border-gold/15 p-2 sm:grid-cols-[1fr_9rem_auto_auto] sm:items-end" key={sub.key}>
      <Field label={`Question ${index + 1}`}><input className="field" onChange={(event) => patchSub(index, { label: event.target.value })} value={sub.label} /></Field>
      <Field label="Type"><select className="field" onChange={(event) => { const type = event.target.value as FormRepeatSubfield["type"]; patchSub(index, type === "select" ? { type, options: sub.options?.length ? sub.options : [{ value: "option_1", label: "Option 1" }] } : { type, options: undefined, optionSource: undefined }); }} value={sub.type}>{SUB_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
      <label className="min-h-11 content-center text-sm text-champagne"><input checked={sub.required === true} onChange={(event) => patchSub(index, { required: event.target.checked || undefined })} type="checkbox" /> Required</label>
      <Button aria-label={`Remove ${sub.label || `question ${index + 1}`}`} className="size-11 min-h-11 p-0" onClick={() => patch({ fields: config.fields.filter((_, at) => at !== index) })} type="button" variant="ghost"><Trash2 className="size-4" /></Button>
      {sub.type === "select" ? <div className="grid gap-2 sm:col-span-4 sm:grid-cols-2">
        <Field label="Choices from"><select className="field" onChange={(event) => patchSub(index, event.target.value ? { optionSource: { kind: "master", masterType: event.target.value }, options: undefined } : { optionSource: undefined, options: sub.options?.length ? sub.options : [{ value: "option_1", label: "Option 1" }] })} value={sub.optionSource?.masterType ?? ""}><option value="">Typed choices</option>{lists.map((list) => <option key={list} value={list}>Dropdown Master: {titleCase(list)}</option>)}</select></Field>
        {!sub.optionSource ? <Field label="Choices (one per line)"><textarea className="field min-h-20" onChange={(event) => { const labels = event.target.value.split("\n").map((line) => line.trim()).filter(Boolean); const used: string[] = []; patchSub(index, { options: labels.map((label) => { const value = keyFor(label, used); used.push(value); return { value, label }; }) }); }} value={(sub.options ?? []).map((option) => option.label).join("\n")} /></Field> : null}
      </div> : null}
    </li>)}</ul>
    {config.fields.length < 10 ? <Button className="justify-self-start" onClick={() => patch({ fields: [...config.fields, { key: keyFor(`answer ${config.fields.length + 1}`, config.fields.map((sub) => sub.key)), label: `Question ${config.fields.length + 1}`, type: "text" }] })} type="button" variant="secondary"><Plus className="size-4" />Add a question per row</Button> : null}
    {!config.fields.length ? <Notice tone="danger">Add at least one question for each row.</Notice> : null}
  </div>;
}

/** A CRM photo question: allow videos, and how many files. */
export function CrmPhotoEditor({ field, onChange }: { field: FormFieldDefinition; onChange: (crm: FormCrmBehaviour) => void }) {
  const crm = field.validation?.crm ?? {};
  return <div className="grid gap-3 rounded-lg border border-gold/15 bg-obsidian/30 p-3 sm:col-span-2 sm:grid-cols-2">
    <p className="text-xs text-soft-grey sm:col-span-2">Photos go straight to the CRM client&apos;s private documents. Works in CRM forms.</p>
    <label className="min-h-11 content-center text-sm text-champagne"><input checked={crm.video === true} onChange={(event) => onChange({ ...crm, video: event.target.checked || undefined })} type="checkbox" /> Also accept videos</label>
    <Field label="Files allowed"><select className="field" onChange={(event) => onChange({ ...crm, maxFiles: Number(event.target.value) })} value={crm.maxFiles ?? 1}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></Field>
  </div>;
}
