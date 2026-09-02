import type { FormFieldDefinition, FormFieldType, FormRule } from "@jewelos/core";

export const OPTION_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set(["select", "radio", "checkbox", "multiselect"]);
export const MULTI_ANSWER_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set(["checkbox", "multiselect"]);
export const LAYOUT_FIELD_TYPES: ReadonlySet<FormFieldType> = new Set(["section_header", "divider"]);

export type FieldTypeConversion = Readonly<{
  fields: readonly FormFieldDefinition[];
  cleared: readonly ("options" | "routing" | "validation")[];
}>;

function rewriteRule(rule: FormRule | undefined, sourceKey: string, nextType: FormFieldType, preserve: boolean): FormRule | undefined {
  if (!rule) return undefined;
  if (rule.kind !== "predicate") {
    const rules = rule.rules.map((child) => rewriteRule(child, sourceKey, nextType, preserve)).filter((child): child is FormRule => child !== undefined);
    if (!rules.length) return undefined;
    return rules.length === 1 ? rules[0] : { kind: rule.kind, rules };
  }
  if (rule.fieldKey !== sourceKey) return rule;
  if (!preserve) return undefined;
  const multi = MULTI_ANSWER_FIELD_TYPES.has(nextType);
  const operator = multi
    ? rule.operator === "equals" ? "contains" : rule.operator === "not_equals" ? "not_contains" : rule.operator
    : rule.operator === "contains" ? "equals" : rule.operator === "not_contains" ? "not_equals" : rule.operator;
  return { ...rule, operator };
}

function pruneRuleOptions(rule: FormRule | undefined, sourceKey: string, allowed: ReadonlySet<string>): FormRule | undefined {
  if (!rule) return undefined;
  if (rule.kind !== "predicate") {
    const rules = rule.rules.map((child) => pruneRuleOptions(child, sourceKey, allowed)).filter((child): child is FormRule => child !== undefined);
    if (!rules.length) return undefined;
    return rules.length === 1 ? rules[0] : { kind: rule.kind, rules };
  }
  if (rule.fieldKey !== sourceKey || rule.value === undefined) return rule;
  if (Array.isArray(rule.value)) {
    const value = rule.value.filter((item) => typeof item !== "string" || allowed.has(item));
    return value.length ? { ...rule, value } : undefined;
  }
  return typeof rule.value === "string" && !allowed.has(rule.value) ? undefined : rule;
}

/** Removes every ID-based dependency on option values that no longer exist. */
export function pruneOptionValueReferences(fields: readonly FormFieldDefinition[], sourceKey: string, allowed: ReadonlySet<string>): readonly FormFieldDefinition[] {
  return fields.map((field) => {
    const branches = field.key === sourceKey
      ? field.branches?.filter((branch) => typeof branch.value !== "string" || allowed.has(branch.value))
      : field.branches;
    const condition = field.condition?.fieldKey === sourceKey && typeof field.condition.value === "string" && !allowed.has(field.condition.value)
      ? undefined : field.condition;
    const rule = pruneRuleOptions(field.rule, sourceKey, allowed);
    return { ...field, branches: branches?.length ? branches : undefined, condition, rule };
  });
}

function compatibleValidation(field: FormFieldDefinition, nextType: FormFieldType) {
  const current = field.validation;
  if (!current) return undefined;
  if (nextType === "text" || nextType === "textarea") {
    const validation = { minLength: current.minLength, maxLength: current.maxLength };
    return validation.minLength === undefined && validation.maxLength === undefined ? undefined : validation;
  }
  if (nextType === "number" || nextType === "currency") {
    const validation = { min: current.min, max: current.max };
    return validation.min === undefined && validation.max === undefined ? undefined : validation;
  }
  return undefined;
}

/** Converts one field and every guided dependency that reads it as one atomic local edit. */
export function convertFormFieldType(fields: readonly FormFieldDefinition[], index: number, nextType: FormFieldType): FieldTypeConversion {
  const source = fields[index];
  if (!source || source.type === nextType) return { fields, cleared: [] };
  const wasChoice = OPTION_FIELD_TYPES.has(source.type);
  const nextChoice = OPTION_FIELD_TYPES.has(nextType);
  const preserveRoutes = wasChoice && nextChoice;
  const cleared = new Set<"options" | "routing" | "validation">();
  const { options: _options, optionSource: _optionSource, branches: _branches, validation: _validation, ...common } = source;
  const validation = compatibleValidation(source, nextType);
  if (source.validation && !validation) cleared.add("validation");
  if (wasChoice && !nextChoice && ((source.options?.length ?? 0) > 0 || source.optionSource)) cleared.add("options");
  if (!preserveRoutes && source.branches?.length) cleared.add("routing");

  let converted: FormFieldDefinition = { ...common, type: nextType, ...(validation ? { validation } : {}) };
  if (nextChoice) {
    converted = {
      ...converted,
      ...(wasChoice && source.optionSource
        ? { optionSource: source.optionSource }
        : { options: wasChoice && source.options?.length ? source.options : [{ value: "option_1", label: "Option 1" }] }),
      ...(preserveRoutes && source.branches?.length ? {
        branches: source.branches.map((branch) => ({
          ...branch,
          operator: MULTI_ANSWER_FIELD_TYPES.has(nextType)
            ? branch.operator === "equals" ? "contains" : branch.operator
            : branch.operator === "contains" ? "equals" : branch.operator,
        })),
      } : {}),
    };
  }
  if (LAYOUT_FIELD_TYPES.has(nextType)) {
    const { required: _required, placeholder: _placeholder, helperText: _helperText, editable: _editable, ...structural } = converted;
    converted = { ...structural, required: false };
  } else if (nextType === "rating" || nextChoice) {
    const { placeholder: _placeholder, ...withoutPlaceholder } = converted;
    converted = withoutPlaceholder;
  }

  const result = fields.map((field, position): FormFieldDefinition => {
    if (position === index) return converted;
    const rule = rewriteRule(field.rule, source.key, nextType, preserveRoutes);
    const condition = field.condition?.fieldKey === source.key
      ? preserveRoutes
        ? { ...field.condition, operator: MULTI_ANSWER_FIELD_TYPES.has(nextType)
          ? field.condition.operator === "equals" ? "contains" : field.condition.operator
          : field.condition.operator === "contains" ? "equals" : field.condition.operator }
        : undefined
      : field.condition;
    if ((field.rule && !rule) || (field.condition && !condition)) cleared.add("routing");
    if (rule === field.rule && condition === field.condition) return field;
    const { rule: _rule, condition: _condition, ...rest } = field;
    return { ...rest, ...(rule ? { rule } : {}), ...(condition ? { condition } : {}) };
  });
  return { fields: result, cleared: [...cleared] };
}
