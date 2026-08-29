import type { FormFieldDefinition, FormOption, FormTemplateDefinition } from "./types";

/** Field types whose answers must be one of a configured option list. */
export const FORM_OPTION_TYPES: ReadonlySet<string> = new Set(["select", "multiselect", "radio"]);

/** A Dropdown Master row, reduced to what the forms engine needs. */
export type FormMasterOption = Readonly<{ masterType: string; value: string; label: string }>;

export function slugifyOptionValue(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
}

/** Builds a stable value that does not collide with the values already in use. */
export function nextOptionValue(label: string, used: readonly string[]): string {
  const base = slugifyOptionValue(label) || "option";
  if (!used.includes(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.includes(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/**
 * Accepts both the historical `string[]` shape and the current `{value,label}[]`
 * shape so forms saved before stable option identity keep rendering.
 */
export function parseFormOptions(raw: unknown): readonly FormOption[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const options: FormOption[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const label = entry.trim();
      if (label) options.push({ value: label, label });
      continue;
    }
    if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const label = typeof record.label === "string" ? record.label.trim() : "";
      const value = typeof record.value === "string" && record.value.trim() ? record.value.trim() : label;
      if (value) options.push({ value, label: label || value });
    }
  }
  return options;
}

/** Tolerates the historical `string[]` shape so option checks work on legacy rows too. */
export function formOptionValues(options: readonly FormOption[] | undefined): readonly string[] {
  return (options ?? []).map((option) => typeof option === "string" ? option : option.value);
}

export function formOptionLabel(options: readonly FormOption[] | undefined, value: string): string {
  const match = (options ?? []).find((option) => (typeof option === "string" ? option : option.value) === value);
  return match === undefined ? value : typeof match === "string" ? match : match.label;
}

/** Options a field actually offers: a Dropdown Master reference resolves against the master list. */
export function resolveFieldOptions(field: FormFieldDefinition, masters: readonly FormMasterOption[] = []): readonly FormOption[] {
  if (!field.optionSource) return field.options ?? [];
  return masters
    .filter((option) => option.masterType === field.optionSource?.masterType)
    .map((option) => ({ value: option.value, label: option.label }));
}

/**
 * Materializes Dropdown Master references into inline options so rendering,
 * validation, and formatting can treat every option field identically. The
 * saved definition keeps the reference — the master stays the source of truth.
 */
export function resolveFormOptions(definition: FormTemplateDefinition, masters: readonly FormMasterOption[] = []): FormTemplateDefinition {
  if (!definition.fields.some((field) => field.optionSource)) return definition;
  return {
    ...definition,
    fields: definition.fields.map(({ optionSource, ...field }) => optionSource ? { ...field, options: resolveFieldOptions({ ...field, optionSource }, masters) } : { ...field, ...(optionSource ? { optionSource } : {}) }),
  };
}
