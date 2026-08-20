export type CrmFieldType = "text" | "number" | "date" | "boolean" | "select" | "multi_select";

export type CrmFieldDefinitionInput = {
  key: string;
  label: string;
  type: CrmFieldType;
  options?: readonly string[];
  required?: boolean;
};

export type CrmFieldDefinition = {
  key: string;
  label: string;
  type: CrmFieldType;
  options: string[];
  required: boolean;
};

export function validateCrmFieldDefinition(input: CrmFieldDefinitionInput): CrmFieldDefinition {
  const key = input.key.trim();
  const label = input.label.trim();
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(key)) throw new Error("field key is invalid");
  if (label.length < 1 || label.length > 120) throw new Error("field label is invalid");
  const options = [...new Set((input.options ?? []).map((option) => option.trim()).filter(Boolean))];
  const selectable = input.type === "select" || input.type === "multi_select";
  if (selectable && options.length === 0) throw new Error("at least one option is required");
  if (!selectable && options.length > 0) throw new Error("options are only allowed for select fields");
  if (options.some((option) => option.length > 120)) throw new Error("field option is too long");
  return { key, label, type: input.type, options, required: input.required === true };
}
