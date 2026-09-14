import { type FormFieldDefinition, type FormFieldType, type FormOption, type FormSectionDefinition, type FormTemplateDefinition } from "./types";
import { OPTION_FIELD_TYPES, pruneOptionValueReferences } from "./fieldTypes";
import { pruneFormRules, renameFormRuleField } from "./rules";

export const DEFAULT_FORM_SECTION: FormSectionDefinition = { key: "section_1", title: "Section 1" };

const labels: Partial<Record<FormFieldType, string>> = {
  text: "Text", textarea: "Text (long)", phone: "Phone Number", number: "Number", select: "Dropdown",
  date: "Date Picker", datetime: "Date and time", checkbox: "Checkbox", radio: "Radio Group", multiselect: "Multi select",
  email: "Email", currency: "Currency", rating: "Rating", file: "File Upload", section_header: "Heading", divider: "Divider",
  user_dropdown: "User", branch_dropdown: "Branch", department_dropdown: "Department",
};

export function nextFormFieldKey(fields: readonly Pick<FormFieldDefinition, "key">[]): string {
  const used = new Set(fields.map((field) => field.key));
  for (let suffix = 1; ; suffix += 1) if (!used.has(`field_${suffix}`)) return `field_${suffix}`;
}

export function createFormField(type: FormFieldType, fields: readonly FormFieldDefinition[], sectionKey: string): FormFieldDefinition {
  return {
    key: nextFormFieldKey(fields), label: labels[type] ?? type.replaceAll("_", " "), type, sortOrder: fields.length,
    sectionKey, required: false, shown: true, editable: true,
    ...(OPTION_FIELD_TYPES.has(type) ? { options: [{ value: "option_1", label: "Option 1" }] as readonly FormOption[] } : {}),
  };
}

function settle(fields: readonly FormFieldDefinition[]): readonly FormFieldDefinition[] {
  return pruneFormRules(fields.map((field, sortOrder) => ({ ...field, sortOrder })));
}

export function insertFormField(definition: FormTemplateDefinition, field: FormFieldDefinition, afterKey?: string): FormTemplateDefinition {
  const fields = [...definition.fields];
  const after = afterKey ? fields.findIndex((item) => item.key === afterKey) : -1;
  const sameSection = fields.flatMap((item, index) => item.sectionKey === field.sectionKey ? [index] : []);
  const insertAt = after >= 0 && fields[after]?.sectionKey === field.sectionKey ? after + 1 : sameSection.length ? Math.max(...sameSection) + 1 : fields.length;
  fields.splice(insertAt, 0, field);
  return { ...definition, fields: settle(fields) };
}

export function updateFormField(definition: FormTemplateDefinition, key: string, patch: Partial<FormFieldDefinition>): FormTemplateDefinition {
  const index = definition.fields.findIndex((field) => field.key === key);
  if (index < 0) return definition;
  const rename = patch.key !== undefined && patch.key !== key ? patch.key : null;
  let fields: readonly FormFieldDefinition[] = definition.fields.map((field, position): FormFieldDefinition => {
    if (position === index) return { ...field, ...patch };
    if (!rename) return field;
    const rule = renameFormRuleField(field.rule, key, rename);
    const condition = field.condition?.fieldKey === key ? { ...field.condition, fieldKey: rename } : field.condition;
    return rule === field.rule && condition === field.condition ? field : { ...field, rule, condition };
  });
  if (patch.options) fields = pruneOptionValueReferences(fields, rename ?? key, new Set(patch.options.map((option) => option.value)));
  return { ...definition, fields: settle(fields) };
}

export function moveFormField(definition: FormTemplateDefinition, key: string, direction: -1 | 1): FormTemplateDefinition {
  const from = definition.fields.findIndex((field) => field.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= definition.fields.length || definition.fields[from]?.sectionKey !== definition.fields[to]?.sectionKey) return definition;
  const fields = [...definition.fields];
  [fields[from], fields[to]] = [fields[to]!, fields[from]!];
  return { ...definition, fields: settle(fields) };
}

export function duplicateFormField(definition: FormTemplateDefinition, key: string): FormTemplateDefinition {
  const index = definition.fields.findIndex((field) => field.key === key);
  const source = definition.fields[index];
  if (!source) return definition;
  const { id: _id, ...copy } = source;
  const fields = [...definition.fields];
  fields.splice(index + 1, 0, { ...copy, key: nextFormFieldKey(fields), label: `${source.label || labels[source.type] || "Field"} copy` });
  return { ...definition, fields: settle(fields) };
}

export function removeFormField(definition: FormTemplateDefinition, key: string): FormTemplateDefinition {
  if (!definition.fields.some((field) => field.key === key)) return definition;
  const fields = definition.fields.filter((field) => field.key !== key).map((field): FormFieldDefinition => ({
    ...field,
    ...(field.condition?.fieldKey === key ? { condition: undefined } : {}),
  }));
  return { ...definition, fields: settle(fields) };
}

const sectionKey = (title: string, used: ReadonlySet<string>) => {
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^([^a-z])/, "s$1").slice(0, 60) || "section";
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) if (!used.has(`${base}_${suffix}`)) return `${base}_${suffix}`;
};

export function addFormSection(definition: FormTemplateDefinition): FormTemplateDefinition {
  const sections = definition.sections?.length ? definition.sections : [DEFAULT_FORM_SECTION];
  const title = `Section ${sections.length + 1}`;
  return { ...definition, sections: [...sections, { key: sectionKey(title, new Set(sections.map((section) => section.key))), title }] };
}

export function updateFormSection(definition: FormTemplateDefinition, key: string, patch: Partial<FormSectionDefinition>): FormTemplateDefinition {
  if (!definition.sections?.some((section) => section.key === key)) return definition;
  return { ...definition, sections: definition.sections.map((section) => section.key === key ? { ...section, ...patch } : section) };
}

export function moveFormSection(definition: FormTemplateDefinition, key: string, direction: -1 | 1): FormTemplateDefinition {
  const sections = [...(definition.sections ?? [])];
  const from = sections.findIndex((section) => section.key === key);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= sections.length) return definition;
  [sections[from], sections[to]] = [sections[to]!, sections[from]!];
  const order = new Map(sections.map((section, index) => [section.key, index]));
  return { ...definition, sections, fields: settle([...definition.fields].sort((a, b) => (order.get(a.sectionKey ?? "") ?? sections.length) - (order.get(b.sectionKey ?? "") ?? sections.length))) };
}

export function removeFormSection(definition: FormTemplateDefinition, key: string): FormTemplateDefinition {
  const sections = (definition.sections ?? []).filter((section) => section.key !== key);
  if (!sections.length || sections.length === definition.sections?.length) return definition;
  const cleanedSections = sections.map((section) => section.next === key ? { ...section, next: undefined } : section);
  const fields = definition.fields.filter((field) => field.sectionKey !== key).map((field): FormFieldDefinition => {
    const branches = field.branches?.filter((branch) => branch.targetSectionKey !== key);
    return field.branches?.length === branches?.length ? field : { ...field, branches: branches?.length ? branches : undefined };
  });
  return { ...definition, sections: cleanedSections, fields: settle(fields) };
}
