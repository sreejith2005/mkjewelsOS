import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import type { FormAnswer, FormFieldDefinition } from "@jewelos/core";
import { makeStyles } from "@/theme/makeStyles";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { OptionPicker, type PickerOption } from "@/ui/OptionPicker";
import { DateField } from "@/forms/DateField";
import { RatingField } from "@/forms/RatingField";
import { ToggleField } from "@/forms/ToggleField";
import { FileField } from "@/forms/FileField";

export type FormFieldProps = Readonly<{
  field: FormFieldDefinition;
  value: FormAnswer | undefined;
  onChange: (value: FormAnswer) => void;
  disabled: boolean;
  invalid: boolean;
  /** Options a field type resolves from the roster rather than its definition. */
  dynamicOptions: readonly PickerOption[];
  templateId?: string;
}>;

/** Field types whose answer is a number rather than text. */
const NUMERIC = new Set(["number", "currency"]);
/** Field types that pick exactly one value from a list. */
const SINGLE_CHOICE = new Set(["select", "radio", "user_dropdown", "branch_dropdown", "department_dropdown"]);

/**
 * Renders one question from its definition.
 *
 * The mapping here is from *field type* to control, never from a field's label
 * or an option's value to behaviour. A new question in the Form Builder that
 * uses an existing type needs no change in this file.
 */
export function FormField({ field, value, onChange, disabled, invalid, dynamicOptions, templateId }: FormFieldProps) {
  const styles = useStyles();
  const options = useMemo<readonly PickerOption[]>(() => {
    if (dynamicOptions.length > 0) return dynamicOptions;
    return (field.options ?? []).map((option) => ({ value: option.value, label: option.label }));
  }, [dynamicOptions, field.options]);

  if (field.type === "section_header") {
    return (
      <Text tone="primary" variant="subtitle" weight="semibold">
        {field.label}
      </Text>
    );
  }
  if (field.type === "divider") return <View style={styles.divider} />;

  const label = field.label;
  const required = field.required === true;

  if (field.type === "file") {
    return (
      <Labelled field={field} invalid={invalid}>
        <FileField
          disabled={disabled}
          fieldKey={field.key}
          onChange={onChange}
          {...(templateId === undefined ? {} : { templateId })}
          value={typeof value === "string" ? value : null}
        />
      </Labelled>
    );
  }

  if (field.type === "rating") {
    return (
      <Labelled field={field} invalid={invalid}>
        <RatingField
          disabled={disabled}
          label={label}
          max={typeof field.validation?.max === "number" ? field.validation.max : 5}
          onChange={onChange}
          value={typeof value === "number" ? value : null}
        />
      </Labelled>
    );
  }

  // A checkbox with options is a multi-answer question; without them it is a
  // single yes/no. The definition decides which, exactly as on the web.
  if (field.type === "checkbox" && options.length > 0) {
    return (
      <Labelled field={field} invalid={invalid}>
        <OptionPicker
          disabled={disabled}
          invalid={invalid}
          label={label}
          multiple
          onChange={(next) => onChange([...next])}
          options={options}
          placeholder="Select any that apply"
          selected={Array.isArray(value) ? value : []}
        />
      </Labelled>
    );
  }

  if (field.type === "checkbox") {
    return (
      <ToggleField
        disabled={disabled}
        label={label}
        onChange={onChange}
        required={required}
        {...(field.helperText === undefined ? {} : { helperText: field.helperText })}
        value={value === true}
      />
    );
  }

  if (field.type === "multiselect") {
    return (
      <Labelled field={field} invalid={invalid}>
        <OptionPicker
          disabled={disabled}
          invalid={invalid}
          label={label}
          multiple
          onChange={(next) => onChange([...next])}
          options={options}
          placeholder="Select any that apply"
          selected={Array.isArray(value) ? value : []}
        />
      </Labelled>
    );
  }

  if (SINGLE_CHOICE.has(field.type)) {
    return (
      <Labelled field={field} invalid={invalid}>
        <OptionPicker
          disabled={disabled}
          invalid={invalid}
          label={label}
          onChange={(next) => onChange(next[0] ?? "")}
          options={options}
          {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
          selected={typeof value === "string" && value ? [value] : []}
        />
      </Labelled>
    );
  }

  if (field.type === "date" || field.type === "datetime") {
    return (
      <Labelled field={field} invalid={invalid}>
        <DateField
          disabled={disabled}
          invalid={invalid}
          label={label}
          mode={field.type}
          onChange={onChange}
          value={typeof value === "string" ? value : null}
        />
      </Labelled>
    );
  }

  // Everything left is typed. The keyboard is chosen from the field type, so a
  // phone number never opens a full QWERTY layout.
  const numeric = NUMERIC.has(field.type);
  return (
    <TextField
      autoCapitalize={field.type === "email" ? "none" : "sentences"}
      autoCorrect={field.type !== "email"}
      editable={!disabled}
      {...(invalid ? { errorText: "This answer needs attention." } : {})}
      {...(field.helperText === undefined ? {} : { helperText: field.helperText })}
      keyboardType={
        field.type === "phone"
          ? "phone-pad"
          : field.type === "email"
            ? "email-address"
            : numeric
              ? "decimal-pad"
              : "default"
      }
      label={label}
      multiline={field.type === "textarea"}
      onChangeText={(text) => onChange(numeric ? (text === "" ? "" : Number(text)) : text)}
      {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
      required={required}
      returnKeyType={field.type === "textarea" ? "default" : "next"}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
    />
  );
}

/** The shared label, helper text, and error slot around a non-text control. */
function Labelled({
  field,
  invalid,
  children,
}: {
  field: FormFieldDefinition;
  invalid: boolean;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <Text tone="warm" variant="label" weight="medium">
        {field.label}
        {field.required ? " *" : ""}
      </Text>
      {field.helperText ? (
        <Text tone="muted" variant="caption">
          {field.helperText}
        </Text>
      ) : null}
      {children}
      {invalid ? (
        <Text accessibilityLiveRegion="polite" tone="danger" variant="caption">
          This answer needs attention.
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  group: { gap: theme.space.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginVertical: theme.space.xs },
}));
