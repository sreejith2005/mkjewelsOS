import { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, findNodeHandle, type NativeScrollEvent } from "react-native";
import {
  isWorkUploadForm,
  nextFormStepKey,
  normalizeFormAnswers,
  previousFormStepKey,
  resolveFormOptions,
  updateVisibleFormAnswers,
  validateCompleteForm,
  validateFormStep,
  visibleFormSections,
  type FormAnswer,
  type FormAnswers,
  type FormFieldDefinition,
  type FormMasterOption,
  type FormTemplateDefinition,
} from "@jewelos/core";
import { errorText } from "@/lib/log";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { Banner } from "@/ui/states";
import { FormField } from "@/forms/FormField";

export type DynamicOptions = Readonly<{
  users: readonly Readonly<{ id: string; label: string }>[];
  branches: readonly Readonly<{ id: string; label: string }>[];
  departments: readonly Readonly<{ id: string; branchId: string | null; label: string }>[];
  masters: readonly FormMasterOption[];
}>;

export const EMPTY_DYNAMIC_OPTIONS: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };

export type FormRendererProps = Readonly<{
  definition: FormTemplateDefinition;
  dynamicOptions?: DynamicOptions;
  initialAnswers?: FormAnswers;
  templateId?: string;
  readOnly?: boolean;
  submitLabel?: string;
  onSubmit?: (answers: FormAnswers) => Promise<void>;
  /** Called whenever an answer changes, so a screen can warn before discarding a draft. */
  onDirtyChange?: (dirty: boolean) => void;
}>;

/**
 * Renders a form from its saved definition.
 *
 * Nothing here knows what any question means. Which fields appear, which
 * options they offer, and whether the answers are acceptable all come from
 * `@jewelos/core` — the identical functions the web renderer calls — so a
 * conditional question added in the Form Builder starts working on the phone
 * without a release. There is no branch in this file keyed to a field label or
 * an option value, and there must never be one.
 */
export function FormRenderer({
  definition,
  dynamicOptions = EMPTY_DYNAMIC_OPTIONS,
  initialAnswers = {},
  templateId,
  readOnly = false,
  submitLabel = "Submit form",
  onSubmit,
  onDirtyChange,
}: FormRendererProps) {
  const styles = useStyles();
  const [answers, setAnswers] = useState<Record<string, FormAnswer>>(() =>
    Object.fromEntries(
      Object.entries(initialAnswers).filter((entry): entry is [string, FormAnswer] => entry[1] != null),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [stepKey, setStepKey] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const positions = useRef(new Map<string, number>());

  // Dropdown Master questions store only a reference; resolving them here means
  // every option field is validated and rendered through one path.
  const resolved = useMemo(() => resolveFormOptions(definition, [...dynamicOptions.masters]), [definition, dynamicOptions.masters]);
  const sections = useMemo(() => visibleFormSections(resolved, answers), [answers, resolved]);
  const stepped = isWorkUploadForm(resolved) && !readOnly;
  const activeStep = stepped ? sections.find(({ section }) => section.key === stepKey) ?? sections[0] : undefined;
  const currentStepKey = activeStep?.section.key;
  const nextStepKey = currentStepKey ? nextFormStepKey(resolved, answers, currentStepKey) : undefined;
  const previousStepKey = currentStepKey ? previousFormStepKey(resolved, answers, currentStepKey) : undefined;
  const renderedSections = stepped ? activeStep ? [activeStep] : [] : sections;
  const showSectionTitles = (resolved.sections?.length ?? 0) > 1;

  // A department question narrows to the branch already chosen on this form,
  // exactly as it does on the web.
  const branchFieldKey = useMemo(
    () => resolved.fields.find((field) => field.type === "branch_dropdown")?.key,
    [resolved],
  );

  const dynamicFor = useCallback(
    (field: FormFieldDefinition) => {
      if (field.type === "user_dropdown") return dynamicOptions.users.map((user) => ({ value: user.id, label: user.label }));
      if (field.type === "branch_dropdown") return dynamicOptions.branches.map((branch) => ({ value: branch.id, label: branch.label }));
      if (field.type === "department_dropdown") {
        const chosenBranch = branchFieldKey ? answers[branchFieldKey] : undefined;
        return dynamicOptions.departments
          .filter((department) => !chosenBranch || department.branchId === chosenBranch)
          .map((department) => ({ value: department.id, label: department.label }));
      }
      return [];
    },
    [answers, branchFieldKey, dynamicOptions],
  );

  const set = useCallback(
    (key: string, value: FormAnswer) => {
      setAnswers((current) => stepped ? updateVisibleFormAnswers(resolved, current, key, value, initialAnswers) : { ...current, [key]: value });
      setFieldError(null);
      setError(null);
      onDirtyChange?.(true);
    },
    [initialAnswers, onDirtyChange, resolved, stepped],
  );

  const advance = () => {
    if (!currentStepKey || !nextStepKey) return;
    const result = validateFormStep(resolved, answers, currentStepKey);
    if (!result.valid) {
      const issue = result.issues[0];
      setError(issue?.message ?? "Check this step before continuing.");
      setFieldError(issue?.fieldKey ?? null);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setError(null);
    setFieldError(null);
    setStepKey(nextStepKey);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const submit = async () => {
    const result = validateCompleteForm(resolved, answers);
    if (!result.valid) {
      const issue = result.issues[0];
      setError(issue?.message ?? "Check the form before submitting.");
      setFieldError(issue?.fieldKey ?? null);
      // Bring the offending question into view: on a phone the failing field is
      // often several screens away from the button that reported it.
      const offset = issue?.fieldKey ? positions.current.get(issue.fieldKey) : undefined;
      if (offset !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, offset - 24), animated: true });
      return;
    }
    if (!onSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(normalizeFormAnswers(resolved, answers));
      setSubmitted(true);
      onDirtyChange?.(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
      >
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {submitted ? <Banner tone="success">Form submitted.</Banner> : null}
        {resolved.fields.length === 0 ? (
          <Banner tone="danger">
            This form version has no saved questions. Ask an administrator to edit and republish it.
          </Banner>
        ) : null}

        {stepped && activeStep ? <Text tone="muted" variant="caption">Step {sections.findIndex(({ section }) => section.key === activeStep.section.key) + 1} of {sections.length}</Text> : null}
        {renderedSections.map(({ section, fields }) => (
          <View key={section.key} style={showSectionTitles ? styles.section : undefined}>
            {showSectionTitles ? (
              <View style={styles.sectionHeader}>
                <Text tone="primary" variant="subtitle" weight="semibold">
                  {section.title}
                </Text>
                {section.description ? (
                  <Text tone="muted" variant="caption">
                    {section.description}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View style={styles.fields}>
              {fields.map((field) => (
                <View
                  key={field.key}
                  onLayout={(event) => positions.current.set(field.key, event.nativeEvent.layout.y)}
                >
                  <FormField
                    disabled={readOnly || field.editable === false}
                    dynamicOptions={dynamicFor(field)}
                    field={field}
                    invalid={fieldError === field.key}
                    onChange={(value) => set(field.key, value)}
                    {...(templateId === undefined ? {} : { templateId })}
                    value={answers[field.key]}
                  />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {!readOnly && resolved.fields.length > 0 ? (
        <View style={styles.footer}>
          {stepped && previousStepKey ? <Button disabled={busy || submitted} full label="Back" onPress={() => { setError(null); setFieldError(null); setStepKey(previousStepKey); scrollRef.current?.scrollTo({ y: 0, animated: true }); }} variant="secondary" /> : null}
          {stepped && nextStepKey ? <Button disabled={busy || submitted} full label="Next" onPress={advance} size="large" />
            : <Button busy={busy} disabled={submitted} full label={submitted ? "Submitted" : submitLabel} onPress={() => void submit()} size="large" />}
        </View>
      ) : null}
    </View>
  );
}

/** Kept so a screen can react to a scroll without importing React Native types. */
export type FormScrollEvent = NativeScrollEvent;
export { findNodeHandle };

const useStyles = makeStyles((theme) => StyleSheet.create({
  root: { flex: 1 },
  content: { padding: theme.space.md, gap: theme.space.md, paddingBottom: theme.space.xl },
  section: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    gap: theme.space.md,
  },
  sectionHeader: { gap: 2 },
  fields: { gap: theme.space.md },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
}));
