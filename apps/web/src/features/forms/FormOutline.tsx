import { ChevronRight, ListTree } from "lucide-react";
import type { FormFieldDefinition, FormSectionDefinition } from "@jewelos/core";

const nameOf = (field: FormFieldDefinition) => field.label || field.type.replaceAll("_", " ");

export function FormOutline({ activeKey, fields, sections, onSelect }: { activeKey?: string; fields: readonly FormFieldDefinition[]; sections: readonly FormSectionDefinition[]; onSelect: (fieldKey: string) => void }) {
  return <>
    <label className="block lg:hidden"><span className="label">Jump to a question</span><select className="field" onChange={(event) => { if (event.target.value) onSelect(event.target.value); }} value={activeKey ?? ""}><option value="">Form outline · {sections.length} sections · {fields.length} questions</option>{sections.map((section) => <optgroup key={section.key} label={section.title}>{fields.filter((field) => (field.sectionKey ?? sections[0]?.key) === section.key).map((field) => <option key={field.key} value={field.key}>{nameOf(field)}</option>)}</optgroup>)}</select></label>
    <aside aria-label="Form outline" className="hidden lg:block"><div className="sticky top-24 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border border-gold/20 bg-charcoal/30 p-3">
      <div className="mb-3 flex items-center gap-2"><ListTree className="size-4 text-gold" /><div><h3 className="text-sm font-semibold text-champagne">Form outline</h3><p className="text-[0.7rem] text-soft-grey">{sections.length} sections · {fields.length} questions</p></div></div>
      <div className="space-y-3">{sections.map((section, sectionIndex) => { const sectionFields = fields.filter((field) => (field.sectionKey ?? sections[0]?.key) === section.key); return <section key={section.key}><div className="mb-1 flex items-center justify-between gap-2 text-[0.7rem] font-semibold uppercase tracking-wide text-soft-grey"><span>{sectionIndex + 1}. {section.title}</span><span>{sectionFields.length}</span></div><div className="space-y-1">{sectionFields.map((field, fieldIndex) => <button aria-label={`Go to ${nameOf(field)}`} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs transition ${field.key === activeKey ? "bg-gold/15 text-gold ring-1 ring-gold/40" : "text-champagne hover:bg-gold/10"}`} key={field.key} onClick={() => onSelect(field.key)} type="button"><span className="w-7 shrink-0 text-soft-grey">{sectionIndex + 1}.{fieldIndex + 1}</span><span className="min-w-0 flex-1 truncate">{nameOf(field)}</span><ChevronRight className="size-3.5 shrink-0" /></button>)}</div></section>; })}</div>
    </div></aside>
  </>;
}

