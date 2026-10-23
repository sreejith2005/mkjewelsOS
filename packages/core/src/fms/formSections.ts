import { formRuleFieldKeys } from "../forms/rules.ts";
import { parseFormOptions } from "../forms/options.ts";
import { formDefinitionForSection } from "../forms/sections.ts";
import type { FormRule, FormTemplateDefinition } from "../forms/types.ts";
import type { FmsFlowDefinition, FmsFormFieldOption, FmsFormFieldRef, FmsFormSectionRef, FmsStageDefinition, FmsValidationContext, FmsValidationIssue } from "./types.ts";
import type { FmsAssignmentSource } from "./workContracts.ts";

type FieldIndex = Readonly<Record<string, readonly FmsFormFieldRef[]>>;

/** The linked Form section a stage asks for; undefined means the Entire Form. */
export function fmsStageFormSectionKey(stage: Pick<FmsStageDefinition, "sla">): string | undefined {
  return stage.sla.formSectionKey || undefined;
}

/** A Form's questions limited to one section, in Form order. No section keeps them all. */
export function fmsSectionFields(fields: readonly FmsFormFieldRef[], sectionKey: string | undefined): readonly FmsFormFieldRef[] {
  return sectionKey ? fields.filter((field) => field.sectionKey === sectionKey) : fields;
}

/**
 * The questions a stage's doer actually answers. Route, assignment, naming and
 * work-detail pickers use this so they never offer a question the stage skips.
 */
export function fmsStageFormFields(stage: Pick<FmsStageDefinition, "sla" | "formTemplateId">, formFields: FieldIndex): readonly FmsFormFieldRef[] {
  if (!stage.formTemplateId) return [];
  return fmsSectionFields(formFields[stage.formTemplateId] ?? [], fmsStageFormSectionKey(stage));
}

/** The Form a stage's doer fills in: the linked section only, or the whole Form. */
export function fmsStageFormDefinition(stage: Pick<FmsStageDefinition, "sla">, form: FormTemplateDefinition): FormTemplateDefinition | undefined {
  const sectionKey = fmsStageFormSectionKey(stage);
  return sectionKey ? formDefinitionForSection(form, sectionKey) : form;
}

/** Same contract for a stored stage row, whose configuration is `planned_time_rule`. */
export function fmsPlannedRuleFormSectionKey(plannedTimeRule: unknown): string | undefined {
  if (!plannedTimeRule || typeof plannedTimeRule !== "object" || Array.isArray(plannedTimeRule)) return undefined;
  const key = (plannedTimeRule as Record<string, unknown>).formSectionKey;
  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

export type FmsFormFieldRow = Readonly<{
  form_template_id: string; field_key: string; field_name: string; field_type: string; is_required: boolean; is_shown: boolean;
  conditional_logic: unknown; rule_definition: unknown; options: unknown; option_source: string | null; dropdown_master_type: string | null; group_name?: string | null | undefined;
}>;
export type FmsFormSectionsRow = Readonly<{ id: string; sections?: unknown }>;
export type FmsFormMasterOption = Readonly<{ master_type: string; value: string; label: string | null }>;

/** Layout-only questions carry no answer, so they can never decide a route. */
const STRUCTURAL_FIELD_TYPES: ReadonlySet<string> = new Set(["section_header", "divider"]);

function storedSections(raw: unknown): readonly Readonly<{ key: string; title: string }>[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key : "";
    return key ? [{ key, title: typeof record.title === "string" && record.title.trim() ? record.title : key }] : [];
  });
}

/** Question keys a stored visibility condition or rule tree reads. */
function conditionFieldKeys(raw: unknown): readonly string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  if (typeof record.kind === "string") return formRuleFieldKeys(record as unknown as FormRule);
  return typeof record.fieldKey === "string" && record.fieldKey ? [record.fieldKey] : [];
}

/**
 * Indexes Form questions and sections by template version, so FMS route
 * configuration and publish readiness reference stable question, option and
 * section keys rather than display labels. A question's section resolves
 * exactly as the database's `form_field_section_key` does: an unknown section
 * falls back to the first one. Dropdown Master questions resolve through the master.
 */
export function fmsFormQuestionIndex(rows: readonly FmsFormFieldRow[], templates: readonly FmsFormSectionsRow[], masters: readonly FmsFormMasterOption[] = []): Readonly<{ formFields: Record<string, readonly FmsFormFieldRef[]>; formSections: Record<string, readonly FmsFormSectionRef[]> }> {
  const sectionsByForm = new Map(templates.map((template) => [template.id, storedSections(template.sections)]));
  const formFields: Record<string, FmsFormFieldRef[]> = {};
  for (const row of rows) {
    if (STRUCTURAL_FIELD_TYPES.has(row.field_type)) continue;
    const sections = sectionsByForm.get(row.form_template_id) ?? [];
    const sectionKey = sections.length ? (sections.find((section) => section.key === row.group_name) ?? sections[0]!).key : undefined;
    const options: FmsFormFieldOption[] = row.option_source === "dropdown_master" && row.dropdown_master_type
      ? masters.filter((option) => option.master_type === row.dropdown_master_type).map((option) => ({ value: option.value, label: option.label || option.value }))
      : (parseFormOptions(row.options) ?? []).map((option) => ({ value: option.value, label: option.label || option.value }));
    const dependsOn = [...new Set([...conditionFieldKeys(row.conditional_logic), ...conditionFieldKeys(row.rule_definition)])];
    (formFields[row.form_template_id] ??= []).push({
      key: row.field_key, label: row.field_name || row.field_key, type: row.field_type, required: row.is_required, shown: row.is_shown,
      hasCondition: row.conditional_logic !== null || row.rule_definition !== null,
      ...(options.length ? { options, optionValues: options.map((option) => option.value) } : {}),
      ...(sectionKey ? { sectionKey } : {}),
      ...(dependsOn.length ? { dependsOn } : {}),
    });
  }
  const formSections: Record<string, readonly FmsFormSectionRef[]> = {};
  for (const [formId, sections] of sectionsByForm) {
    if (!sections.length) continue;
    const fields = formFields[formId] ?? [];
    formSections[formId] = sections.map((section) => ({ ...section, questionCount: fields.filter((field) => field.sectionKey === section.key).length }));
  }
  return { formFields, formSections };
}

/** Every question of an earlier stage that a stage reads: owner, record name and work details. */
function readSources(stage: FmsStageDefinition): readonly FmsAssignmentSource[] {
  const display = stage.sla.taskDisplay;
  return [
    ...(stage.sla.assignment?.followFormAssignee ? [] : stage.sla.assignment?.sources ?? []),
    ...(display?.recordNaming?.source ? [display.recordNaming.source] : []),
    ...(display?.referenceField ? [display.referenceField] : []),
    ...(display?.fields ?? []),
  ];
}

/**
 * Publish-readiness for section-scoped stages. The server repeats these checks
 * in `assert_fms_form_sections_publishable`; this copy names the exact control.
 */
export function validateFmsFormSections(definition: FmsFlowDefinition, context: FmsValidationContext): readonly FmsValidationIssue[] {
  const issues: FmsValidationIssue[] = [];
  const byKey = new Map(definition.stages.map((stage) => [stage.key, stage]));
  for (const [index, stage] of definition.stages.entries()) {
    const sectionKey = fmsStageFormSectionKey(stage);
    if (!sectionKey) continue;
    const add = (code: string, message: string) => issues.push({ code, message, stageKey: stage.key });
    if (index === 0) { add("section_on_trigger", "The starting Form always uses the entire Form. Choose Entire Form for this step."); continue; }
    if (!stage.formTemplateId) { add("section_without_form", "Link a Form before choosing one of its sections."); continue; }
    const section = context.formSections?.[stage.formTemplateId]?.find((item) => item.key === sectionKey);
    if (context.formSections && !section) { add("missing_form_section", "The selected section is no longer in this version of the linked Form. Choose a section again."); continue; }
    const all = context.formFields?.[stage.formTemplateId];
    if (!all) continue;
    const inSection = fmsSectionFields(all, sectionKey);
    const asked = new Set(inSection.map((field) => field.key));
    const labelOf = (key: string) => all.find((field) => field.key === key)?.label ?? key;
    if (section && !inSection.length) add("empty_form_section", `Section "${section.title}" has no questions to answer. Choose another section.`);
    for (const field of inSection) {
      for (const dependency of field.dependsOn ?? []) {
        if (!asked.has(dependency) && all.some((item) => item.key === dependency)) add("external_section_dependency", `"${field.label}" is shown only depending on "${labelOf(dependency)}", which is in another section. Use Entire Form, or move that question into this section.`);
      }
    }
    for (const rule of stage.branchRules) {
      if (rule.source !== "form_answer" || rule.operator === "default" || !rule.sourceKey || asked.has(rule.sourceKey) || !all.some((field) => field.key === rule.sourceKey)) continue;
      const label = rule.label ? `"${rule.label}"` : `Route ${rule.order + 1}`;
      add("route_field_outside_section", `${label} uses "${labelOf(rule.sourceKey)}", which is not in this step's section. Choose a question from the selected section.`);
    }
    if (stage.sla.assignmentFieldKey && !asked.has(stage.sla.assignmentFieldKey)) add("invalid_assignment_field", "The User question that assigns later steps must be in this step's section.");
  }
  for (const stage of definition.stages) {
    for (const source of readSources(stage)) {
      const sourceStage = byKey.get(source.sourceStageKey);
      const sectionKey = sourceStage ? fmsStageFormSectionKey(sourceStage) : undefined;
      if (!sourceStage || !sectionKey || !sourceStage.formTemplateId) continue;
      const field = context.formFields?.[sourceStage.formTemplateId]?.find((item) => item.key === source.fieldKey);
      if (field && field.sectionKey !== sectionKey) {
        issues.push({ code: "source_field_outside_section", stageKey: stage.key, message: `"${field.label}" is not in the section that "${sourceStage.name}" asks for, so it will never be answered. Choose a question from that section.` });
      }
    }
  }
  return issues;
}
