import { FORM_OPTION_TYPES, FORM_OTHER_TYPES, parseFormOptions } from "./options.ts";
import { FORM_RULE_OPERATORS, formRuleFieldKeys, formRuleHasIncompletePredicate, normalizeFormRule, validateFormRule } from "./rules.ts";
import { FORM_QUESTION_TARGET_PREFIX, FORM_CONTINUE_TARGET, FORM_STAGE_END_TARGET, fieldSectionKey, formSections } from "./sections.ts";
import { eligibleRecordNameFields } from "../fms/recordNaming.ts";
import { FORM_DRAFT_FIELD_TYPES, FORM_SUBMIT_TARGET, type FormRule, type FormBranch, type FormFieldDefinition, type FormSectionDefinition, type FormTemplateDefinition, type FormValidationIssue } from "./types.ts";

const BRANCH_TYPES: ReadonlySet<string> = new Set(FORM_DRAFT_FIELD_TYPES.filter(type => type !== "section_header" && type !== "divider"));
const LAYOUT_TYPES = new Set(["section_header", "divider"]);
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const BRANCH_OPERATORS: ReadonlySet<string> = new Set([...FORM_RULE_OPERATORS, "default"]);

function text(value: unknown): string | undefined {
  const normalized = typeof value === "string" ? value.trim() : undefined;
  return normalized ? normalized : undefined;
}

function requiredText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSections(sections: readonly FormSectionDefinition[] | undefined): readonly FormSectionDefinition[] | undefined {
  if (!sections?.length) return undefined;
  return Object.freeze(sections.map((section) => Object.freeze({
    key: requiredText(section.key).toLowerCase(),
    ...(section.visibility ? { visibility: section.visibility } : {}),
    ...(section.rule ? { rule: normalizeFormRule(section.rule) } : {}),
    title: requiredText(section.title),
    ...(text(section.description) ? { description: text(section.description) } : {}),
    ...(text(section.next) ? { next: requiredText(section.next).toLowerCase() } : {}),
  })));
}

function normalizeBranches(field: FormFieldDefinition): readonly FormBranch[] | undefined {
  if (!field.branches?.length || !BRANCH_TYPES.has(field.type)) return undefined;
  return Object.freeze(field.branches.map((branch) => Object.freeze({
    operator: branch.operator,
    ...(branch.rule ? { rule: normalizeFormRule(branch.rule) } : {}),
    ...(text(branch.name) ? { name: text(branch.name) } : {}),
    ...(branch.operator === "not_empty" ? {} : { value: branch.value }),
    targetSectionKey: requiredText(branch.targetSectionKey).toLowerCase(),
  })));
}

export function normalizeFormDefinition(template: FormTemplateDefinition): FormTemplateDefinition {
  const sections = normalizeSections(template.sections);
  const sectionList = sections ?? [];
  const order = new Map(sectionList.map((section, index) => [section.key, index]));
  const fields = template.fields
    .map((field) => ({ field, sectionIndex: sectionList.length ? order.get(requiredText(field.sectionKey).toLowerCase()) ?? 0 : 0 }))
    .sort((a, b) => a.sectionIndex - b.sectionIndex || a.field.sortOrder - b.field.sortOrder || a.field.key.localeCompare(b.field.key))
    .map(({ field, sectionIndex }, sortOrder): FormFieldDefinition => {
      const options = parseFormOptions(field.options);
      const branches = normalizeBranches(field);
      // A rule supersedes the single legacy condition, so only one of the two survives.
      const rule = normalizeFormRule(field.rule);
      return Object.freeze({
        ...(field.id ? { id: field.id } : {}),
        key: requiredText(field.key).toLowerCase(),
        label: requiredText(field.label),
        type: field.type,
        sortOrder,
        ...(sectionList.length ? { sectionKey: sectionList[sectionIndex]!.key } : {}),
        required: field.required === true,
        shown: field.shown !== false,
        editable: field.editable !== false,
        ...(text(field.placeholder) ? { placeholder: text(field.placeholder) } : {}),
        ...(text(field.helperText) ? { helperText: text(field.helperText) } : {}),
        ...(field.optionSource
          ? { optionSource: Object.freeze({ kind: "master" as const, masterType: requiredText(field.optionSource.masterType) }) }
          : options ? { options: Object.freeze(options.map((option) => Object.freeze({ value: requiredText(option.value), label: requiredText(option.label) }))) } : {}),
        ...(branches ? { branches } : {}),
        ...(field.validation ? { validation: Object.freeze({ ...field.validation }) } : {}),
        ...(rule ? { rule } : field.condition ? { condition: Object.freeze({ ...field.condition, fieldKey: requiredText(field.condition.fieldKey).toLowerCase() }) } : {}),
      });
    });
  return Object.freeze({
    ...template,
    name: requiredText(template.name),
    ...(text(template.recordNameFieldKey) ? { recordNameFieldKey: requiredText(template.recordNameFieldKey).toLowerCase() } : {}),
    ...(text(template.description) ? { description: text(template.description) } : {}),
    sections,
    fields: Object.freeze(fields),
    permissions: template.permissions
      ? Object.freeze({ roles: Object.freeze([...template.permissions.roles]) })
      : undefined,
  });
}

function validateSections(template: FormTemplateDefinition, issues: FormValidationIssue[]): void {
  const sections = template.sections ?? [];
  if (!sections.length) return;
  if (sections.length > 50) issues.push({ code: "too_many_sections", message: "A form can contain at most 50 sections" });
  const keys = new Set<string>();
  for (const section of sections) {
    if (!KEY_PATTERN.test(section.key)) issues.push({ code: "invalid_section_key", message: "Section key " + section.key + " is invalid" });
    if (keys.has(section.key)) issues.push({ code: "duplicate_section_key", message: "Section keys must be unique" });
    keys.add(section.key);
    if (!section.title.trim() || section.title.length > 150) issues.push({ code: "invalid_section_title", message: "Section titles must contain 1 to 150 characters" });
    if ((section.description?.length ?? 0) > 500) issues.push({ code: "invalid_section_description", message: "Section description is too long" });
  }
  sections.forEach((section, index) => {
    if (!section.next || [FORM_SUBMIT_TARGET, FORM_STAGE_END_TARGET, FORM_CONTINUE_TARGET].includes(section.next)) return;
    if (section.next.startsWith(FORM_QUESTION_TARGET_PREFIX)) {
      const question = template.fields.find(f => f.key === section.next?.slice(FORM_QUESTION_TARGET_PREFIX.length));
      const targetIndex = question ? sections.findIndex(s => s.key === fieldSectionKey(question, sections)) : -1;
      if (targetIndex <= index) issues.push({ code: "backward_section_target", message: section.title + " must continue to a question in a later section" });
      return;
    }
    const targetIndex = sections.findIndex((item) => item.key === section.next);
    if (targetIndex === -1) issues.push({ code: "unknown_section_target", message: section.title + " continues to a section that no longer exists" });
    else if (targetIndex <= index) issues.push({ code: "backward_section_target", message: section.title + " must continue to a later section" });
  });
  for (const [index, section] of sections.entries()) {
    if (section.visibility && !["always", "when", "unless", "routed"].includes(section.visibility)) issues.push({ code: "invalid_section_visibility", message: "Invalid section visibility" });
    if ((section.visibility === "when" || section.visibility === "unless") && (!section.rule || formRuleHasIncompletePredicate(section.rule))) issues.push({ code: "incomplete_section_rule", message: section.title + " needs a complete condition" });
    const earlier = new Set(template.fields.filter(f => sections.findIndex(s => s.key === fieldSectionKey(f, sections)) < index).map(f => f.key));
    if (section.rule) issues.push(...validateFormRule(section.rule, { key: section.key, label: section.title, type: "section_header", sortOrder: 0 }, earlier));
  }
  for (const field of template.fields) {
    if (field.sectionKey && !keys.has(field.sectionKey)) issues.push({ code: "unknown_section", fieldKey: field.key, message: (field.label || field.key) + " belongs to a section that no longer exists" });
  }
}

function validateBranches(template: FormTemplateDefinition, field: FormFieldDefinition, issues: FormValidationIssue[]): void {
  const branches = field.branches ?? [];
  if (!branches.length) return;
  const name = field.label || field.key;
  if (!BRANCH_TYPES.has(field.type)) {
    issues.push({ code: "branch_unsupported", fieldKey: field.key, message: "Only dropdown and radio questions can send the respondent to another section" });
    return;
  }
  if (branches.length > 50) issues.push({ code: "too_many_branches", fieldKey: field.key, message: "A question can define at most 50 branches" });
  const sections = formSections(template);
  const sourceIndex = sections.findIndex((section) => section.key === fieldSectionKey(field, sections));
  const optionValues = new Set((field.options ?? []).map((option) => option.value));
  for (const branch of branches) {
    if (!BRANCH_OPERATORS.has(branch.operator)) issues.push({ code: "invalid_branch_operator", fieldKey: field.key, message: "Branch operator is unsupported" });
    if (!branch.rule && branch.operator !== "default" && branch.operator !== "is_empty" && branch.operator !== "not_empty" && branch.value === undefined) issues.push({ code: "missing_branch_value", fieldKey: field.key, message: "A branch needs the answer it should match" });
    else if (!branch.rule && branch.operator !== "default" && branch.operator !== "not_empty" && !field.optionSource && typeof branch.value === "string" && !optionValues.has(branch.value)) {
      issues.push({ code: "unknown_branch_option", fieldKey: field.key, message: name + " branches on an option that no longer exists" });
    }
    if (branch.rule) {
      const available = new Set(template.fields.filter(f => f.sortOrder <= field.sortOrder).map(f => f.key));
      if (formRuleHasIncompletePredicate(branch.rule)) issues.push({ code: "incomplete_route_rule", fieldKey: field.key, message: name + " has an incomplete routing condition" });
      if (formRuleFieldKeys(branch.rule).some(key => !available.has(key))) issues.push({ code: "invalid_route_dependency", fieldKey: field.key, message: name + " routes using an unavailable question" });
    }
    if ([FORM_SUBMIT_TARGET, FORM_STAGE_END_TARGET, FORM_CONTINUE_TARGET].includes(branch.targetSectionKey)) continue;
    if (branch.targetSectionKey.startsWith(FORM_QUESTION_TARGET_PREFIX)) {
      const target = template.fields.find(f => f.key === branch.targetSectionKey.slice(FORM_QUESTION_TARGET_PREFIX.length));
      const targetSection = target ? sections.findIndex(s => s.key === fieldSectionKey(target, sections)) : -1;
      if (!target) issues.push({ code: "unknown_branch_target", fieldKey: field.key, message: name + " routes to a missing question" });
      else if (targetSection < sourceIndex || targetSection === sourceIndex && target.sortOrder <= field.sortOrder) issues.push({ code: "backward_branch", fieldKey: field.key, message: name + " must route to a later question" });
      continue;
    }
    const targetIndex = sections.findIndex((section) => section.key === branch.targetSectionKey);
    if (targetIndex === -1) issues.push({ code: "unknown_branch_target", fieldKey: field.key, message: name + " branches to a section that no longer exists" });
    else if (targetIndex <= sourceIndex) issues.push({ code: "backward_branch", fieldKey: field.key, message: name + " must branch to a later section" });
  }
}

function validateRuleOptions(rule: FormRule | undefined, template: FormTemplateDefinition, fieldKey: string | undefined, issues: FormValidationIssue[]): void {
  if (!rule) return;
  if (rule.kind !== "predicate") { for (const child of rule.rules) validateRuleOptions(child, template, fieldKey, issues); return; }
  const source = template.fields.find(f => f.key === rule.fieldKey);
  if (!source || source.shown === false || LAYOUT_TYPES.has(source.type)) { issues.push({ code: "unavailable_rule_source", fieldKey, message: "A condition reads a missing or unavailable question." }); return; }
  if (source.optionSource || !source.options?.length || ["is_empty", "not_empty"].includes(rule.operator)) return;
  const values = Array.isArray(rule.value) ? rule.value : [rule.value];
  if (values.some(value => !source.options!.some(option => option.value === value))) issues.push({ code: "unknown_rule_option", fieldKey, message: "A condition refers to an answer option that no longer exists." });
}

export function validateFormDefinition(template: FormTemplateDefinition): readonly FormValidationIssue[] {
  const issues: FormValidationIssue[] = [];
  if (template.recordNameFieldKey && !eligibleRecordNameFields(template.fields).some(field => field.key === template.recordNameFieldKey)) issues.push({ code: "invalid_record_name", message: "Choose a visible identifying question as the record name." });
  if (!template.name.trim() || template.name.trim().length > 150) issues.push({ code: "invalid_name", message: "Form name must contain 1 to 150 characters" });
  if ((template.description?.length ?? 0) > 2000) issues.push({ code: "invalid_description", message: "Form description is too long" });
  if (template.fields.length > 100) issues.push({ code: "too_many_fields", message: "A form can contain at most 100 fields" });
  validateSections(template, issues);
  for (const section of template.sections ?? []) validateRuleOptions(section.rule, template, undefined, issues);
  for (const field of template.fields) {
    validateRuleOptions(field.rule, template, field.key, issues);
    for (const branch of field.branches ?? []) if (branch.rule) {
      validateRuleOptions(branch.rule, template, field.key, issues);
      const available = new Set(template.fields.filter(f => f.sortOrder <= field.sortOrder).map(f => f.key));
      issues.push(...validateFormRule(branch.rule, { ...field, key: "__route__" }, available).map(issue => ({ ...issue, fieldKey: field.key })));
    }
  }
  const sections = template.sections ?? [];
  const sectionOrder = new Map(sections.map((section, index) => [section.key, index]));
  const keys = new Set<string>();
  const earlier = new Set<string>();
  let previousSectionIndex = -1;
  [...template.fields].sort((a, b) => a.sortOrder - b.sortOrder).forEach((field, index) => {
    if (!(FORM_DRAFT_FIELD_TYPES as readonly string[]).includes(field.type)) issues.push({ code: "invalid_type", fieldKey: field.key, message: "Field type is unsupported" });
    if (!KEY_PATTERN.test(field.key)) issues.push({ code: "invalid_key", fieldKey: field.key, message: "Field key is invalid" });
    if (keys.has(field.key)) issues.push({ code: "duplicate_key", fieldKey: field.key, message: "Field keys must be unique" });
    keys.add(field.key);
    if (field.sortOrder !== index) issues.push({ code: "invalid_order", fieldKey: field.key, message: "Field ordering must be zero-based and contiguous" });
    if (sections.length) {
      const sectionIndex = sectionOrder.get(field.sectionKey ?? "") ?? -1;
      if (sectionIndex !== -1 && sectionIndex < previousSectionIndex) issues.push({ code: "unordered_sections", fieldKey: field.key, message: "Fields must be stored grouped in section order" });
      previousSectionIndex = Math.max(previousSectionIndex, sectionIndex);
    }
    if (!field.label || field.label.length > 200) issues.push({ code: "invalid_label", fieldKey: field.key, message: "Field label must contain 1 to 200 characters" });
    if ((field.placeholder?.length ?? 0) > 300 || (field.helperText?.length ?? 0) > 500) issues.push({ code: "invalid_help_text", fieldKey: field.key, message: "Field helper text is too long" });
    const options = field.options ?? [];
    if (FORM_OPTION_TYPES.has(field.type)) {
      if (field.optionSource) {
        if (!field.optionSource.masterType.trim() || field.optionSource.masterType.length > 100) issues.push({ code: "invalid_option_source", fieldKey: field.key, message: "Choose a Dropdown Master list for this question" });
        if (options.length) issues.push({ code: "duplicated_option_source", fieldKey: field.key, message: "A Dropdown Master question must not copy the master options" });
      } else if ((options.length === 0 && field.type !== "checkbox") || options.length > 100
        || new Set(options.map((option) => option.value)).size !== options.length
        || options.some((option) => !option.value || !option.label || option.value.length > 200 || option.label.length > 200)) {
        issues.push({ code: "invalid_options", fieldKey: field.key, message: "Option fields require 1 to 100 uniquely identified options" });
      }
    } else if (options.length > 0 || field.optionSource) issues.push({ code: "unexpected_options", fieldKey: field.key, message: "This field type cannot define options" });
    if (LAYOUT_TYPES.has(field.type) && field.required) issues.push({ code: "layout_required", fieldKey: field.key, message: "Layout fields cannot be required" });
    validateBranches(template, field, issues);
    issues.push(...validateFormRule(field.rule, field, earlier));
    if (field.rule && field.condition) issues.push({ code: "conflicting_condition", fieldKey: field.key, message: (field.label || field.key) + " cannot define both a condition and a rule" });
    if (field.condition) {
      if (field.condition.fieldKey === field.key) issues.push({ code: "self_dependency", fieldKey: field.key, message: "A field cannot depend on itself" });
      else if (!earlier.has(field.condition.fieldKey)) issues.push({ code: "invalid_dependency", fieldKey: field.key, message: "Conditions must reference an earlier field" });
      if (field.condition.operator !== "not_empty" && field.condition.value === undefined) issues.push({ code: "missing_condition_value", fieldKey: field.key, message: "The condition requires a comparison value" });
    }
    const validation = field.validation;
    if (validation) {
      if ((validation.minLength !== undefined && (!Number.isInteger(validation.minLength) || validation.minLength < 0 || validation.minLength > 5000)) ||
          (validation.maxLength !== undefined && (!Number.isInteger(validation.maxLength) || validation.maxLength < 0 || validation.maxLength > 5000)) ||
          (validation.minLength !== undefined && validation.maxLength !== undefined && validation.minLength > validation.maxLength) ||
          (validation.min !== undefined && validation.max !== undefined && validation.min > validation.max)) {
        issues.push({ code: "invalid_validation", fieldKey: field.key, message: "Field validation bounds are invalid" });
      }
      if (validation.allowOther !== undefined && (typeof validation.allowOther !== "boolean" || !FORM_OTHER_TYPES.has(field.type))) {
        issues.push({ code: "invalid_validation", fieldKey: field.key, message: "Only choice questions can offer an Other answer" });
      }
    }
    earlier.add(field.key);
  });
  return issues;
}
