import { FORM_DRAFT_FIELD_TYPES, type FormFieldDefinition, type FormTemplateDefinition, type FormValidationIssue } from "./types";

const OPTION_TYPES = new Set(["select", "multiselect", "radio"]);
const LAYOUT_TYPES = new Set(["section_header", "divider"]);
const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function text(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function normalizeFormDefinition(template: FormTemplateDefinition): FormTemplateDefinition {
  const fields = [...template.fields]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key))
    .map((field, sortOrder): FormFieldDefinition => Object.freeze({
      ...(field.id ? { id: field.id } : {}),
      key: field.key.trim().toLowerCase(),
      label: field.label.trim(),
      type: field.type,
      sortOrder,
      required: field.required === true,
      shown: field.shown !== false,
      editable: field.editable !== false,
      ...(text(field.placeholder) ? { placeholder: text(field.placeholder) } : {}),
      ...(text(field.helperText) ? { helperText: text(field.helperText) } : {}),
      ...(field.options ? { options: Object.freeze(field.options.map((option) => option.trim())) } : {}),
      ...(field.validation ? { validation: Object.freeze({ ...field.validation }) } : {}),
      ...(field.condition ? { condition: Object.freeze({ ...field.condition, fieldKey: field.condition.fieldKey.trim().toLowerCase() }) } : {}),
    }));
  return Object.freeze({
    ...template,
    name: template.name.trim(),
    ...(text(template.description) ? { description: text(template.description) } : {}),
    fields: Object.freeze(fields),
    permissions: template.permissions
      ? Object.freeze({ roles: Object.freeze([...template.permissions.roles]) })
      : undefined,
  });
}

export function validateFormDefinition(template: FormTemplateDefinition): readonly FormValidationIssue[] {
  const issues: FormValidationIssue[] = [];
  if (!template.name.trim() || template.name.trim().length > 150) issues.push({ code: "invalid_name", message: "Form name must contain 1 to 150 characters" });
  if ((template.description?.length ?? 0) > 2000) issues.push({ code: "invalid_description", message: "Form description is too long" });
  if (template.fields.length > 100) issues.push({ code: "too_many_fields", message: "A form can contain at most 100 fields" });
  const keys = new Set<string>();
  const earlier = new Set<string>();
  [...template.fields].sort((a, b) => a.sortOrder - b.sortOrder).forEach((field, index) => {
    if (!(FORM_DRAFT_FIELD_TYPES as readonly string[]).includes(field.type)) issues.push({ code: "invalid_type", fieldKey: field.key, message: "Field type is unsupported" });
    if (!KEY_PATTERN.test(field.key)) issues.push({ code: "invalid_key", fieldKey: field.key, message: "Field key is invalid" });
    if (keys.has(field.key)) issues.push({ code: "duplicate_key", fieldKey: field.key, message: "Field keys must be unique" });
    keys.add(field.key);
    if (field.sortOrder !== index) issues.push({ code: "invalid_order", fieldKey: field.key, message: "Field ordering must be zero-based and contiguous" });
    if (!field.label || field.label.length > 200) issues.push({ code: "invalid_label", fieldKey: field.key, message: "Field label must contain 1 to 200 characters" });
    if ((field.placeholder?.length ?? 0) > 300 || (field.helperText?.length ?? 0) > 500) issues.push({ code: "invalid_help_text", fieldKey: field.key, message: "Field helper text is too long" });
    const options = field.options ?? [];
    const canonicalOptions = options.map((option) => option.trim());
    if (OPTION_TYPES.has(field.type)) {
      if (canonicalOptions.length === 0 || canonicalOptions.length > 100 || new Set(canonicalOptions).size !== canonicalOptions.length || canonicalOptions.some((option) => !option || option.length > 200)) {
        issues.push({ code: "invalid_options", fieldKey: field.key, message: "Option fields require 1 to 100 unique bounded options" });
      }
    } else if (options.length > 0) issues.push({ code: "unexpected_options", fieldKey: field.key, message: "This field type cannot define options" });
    if (LAYOUT_TYPES.has(field.type) && field.required) issues.push({ code: "layout_required", fieldKey: field.key, message: "Layout fields cannot be required" });
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
    }
    earlier.add(field.key);
  });
  return issues;
}
