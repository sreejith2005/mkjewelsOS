import { useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import {
  FORM_SUBMIT_TARGET,
  LAYOUT_FIELD_TYPES,
  OPTION_FIELD_TYPES,
  addFormSection,
  createFormField,
  convertFormFieldType,
  duplicateFormField,
  formRuleHasIncompletePredicate,
  insertFormField,
  moveFormField,
  moveFormSection,
  normalizeFormDefinition,
  removeFormField,
  removeFormSection,
  resolveFormOptions,
  updateFormField,
  updateFormSection,
  validateFormDefinition,
  type FormFieldDefinition,
  type FormFieldType,
  type FormOption,
  type FormTemplateDefinition,
  type UserRole,
} from "@jewelos/core";
import { loadFormDynamicOptions, loadForms, publishForm, type FormBundle } from "@jewelos/data/forms/api";
import { formBuilderDefinition, saveFormBuilder } from "@/features/forms/formBuilderController";
import { FormRenderer } from "@/forms/FormRenderer";
import { useAsyncData } from "@/lib/useAsyncData";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import type { RootStackParamList } from "@/navigation/types";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Sheet } from "@/ui/Sheet";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type Route = RouteProp<RootStackParamList, "FormBuilder">;
type BuilderMode = "edit" | "preview" | "routes";

const FIELD_TYPES: readonly Readonly<{ value: FormFieldType; label: string }>[] = [
  { value: "text", label: "Text" }, { value: "textarea", label: "Long text" }, { value: "number", label: "Number" },
  { value: "currency", label: "Currency" }, { value: "email", label: "Email" }, { value: "phone", label: "Phone" },
  { value: "date", label: "Date" }, { value: "datetime", label: "Date and time" }, { value: "select", label: "Dropdown" },
  { value: "radio", label: "Radio group" }, { value: "checkbox", label: "Checkbox" }, { value: "multiselect", label: "Multi-select" },
  { value: "rating", label: "Rating" }, { value: "file", label: "File upload" }, { value: "user_dropdown", label: "User" },
  { value: "branch_dropdown", label: "Branch" }, { value: "department_dropdown", label: "Department" },
  { value: "section_header", label: "Heading" }, { value: "divider", label: "Divider" },
];
const ROLES: readonly UserRole[] = ["super_admin", "admin", "manager", "hr", "crm", "staff", "doer", "housekeeping"];

const loadBuilder = async (id?: string) => {
  const [forms, dynamicOptions] = await Promise.all([loadForms(), loadFormDynamicOptions()]);
  const bundle = id ? forms.bundles.find((item) => item.id === id) : undefined;
  if (id && !bundle) throw new Error("This form version is no longer available.");
  return { bundle, dynamicOptions };
};

export function FormBuilderScreen() {
  const route = useRoute<Route>();
  const state = useAsyncData(() => loadBuilder(route.params?.formTemplateId), [route.params?.formTemplateId]);
  if (state.loading) return <LoadingState label="Loading form builder..." />;
  if (state.error || !state.data) return <ErrorState message={state.error ?? "Form builder could not be loaded."} onRetry={() => void state.reload()} />;
  return <FormBuilderWorkspace bundle={state.data.bundle} dynamicOptions={state.data.dynamicOptions} onRefresh={state.refresh} />;
}

function FormBuilderWorkspace({ bundle, dynamicOptions, onRefresh }: Readonly<{ bundle: FormBundle | undefined; dynamicOptions: Awaited<ReturnType<typeof loadFormDynamicOptions>>; onRefresh: () => Promise<void> }>) {
  const navigation = useNavigation();
  const styles = useStyles();
  const initial = useMemo(() => formBuilderDefinition(bundle), [bundle]);
  const [definition, setDefinition] = useState<FormTemplateDefinition>(initial);
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [template, setTemplate] = useState<Pick<FormBundle, "id" | "lifecycle"> | undefined>(bundle);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [mode, setMode] = useState<BuilderMode>("edit");
  const [message, setMessage] = useState<string | null>(null);
  const normalized = useMemo(() => normalizeFormDefinition(definition), [definition]);
  const routingDefinition = useMemo(() => resolveFormOptions(normalized, dynamicOptions.masters), [dynamicOptions.masters, normalized]);
  const issues = useMemo(() => [
    ...validateFormDefinition(normalized),
    ...definition.fields.filter((field) => formRuleHasIncompletePredicate(field.rule)).map((field) => ({ code: "incomplete_rule", fieldKey: field.key, message: `Finish or remove the visibility condition on ${field.label || field.key}.` })),
  ], [definition.fields, normalized]);
  const dirty = JSON.stringify(normalized) !== baseline;
  const selected = normalized.fields.find((field) => field.key === selectedKey);
  useUnsavedGuard(dirty, "Discard changes?", "This form has unsaved changes.");

  const mutate = (next: FormTemplateDefinition) => { setDefinition(next); setMessage(null); };
  const save = async (publish: boolean) => {
    if (issues.length) { setMessage(issues[0]?.message ?? "Fix the form before saving."); return; }
    setBusy(publish ? "publish" : "save"); setMessage(null);
    try {
      const id = await saveFormBuilder(template, normalized);
      if (publish) await publishForm(id);
      const nextTemplate = { id, lifecycle: publish ? "published" as const : template?.lifecycle ?? "draft" as const };
      setTemplate(nextTemplate); setBaseline(JSON.stringify(normalized));
      await onRefresh();
      setMessage(publish ? "Form published." : "Draft saved.");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Unable to save the form."); }
    finally { setBusy(null); }
  };

  if (mode === "preview") return <View style={styles.fill}><View style={styles.header}><Button label="Back to builder" onPress={() => setMode("edit")} variant="ghost" /><Text style={styles.headerTitle} numberOfLines={1} weight="semibold">Preview: {normalized.name || "Untitled form"}</Text></View><FormRenderer definition={normalized} dynamicOptions={dynamicOptions} onSubmit={async () => setMessage("Preview completed. Nothing was submitted.")} submitLabel="Complete preview" />{message ? <Banner tone="success">{message}</Banner> : null}</View>;

  if (mode === "routes") return <View style={styles.fill}><View style={styles.header}><Button label="Back to builder" onPress={() => setMode("edit")} variant="ghost" /><Text style={styles.headerTitle} numberOfLines={1} weight="semibold">Answer routes</Text></View><FlatList contentContainerStyle={styles.list} data={routingDefinition.fields.filter((field) => OPTION_FIELD_TYPES.has(field.type))} keyExtractor={(field) => field.key} ListEmptyComponent={<Banner>No choice questions have routes yet.</Banner>} renderItem={({ item }) => <RouteCard definition={definition} field={item} onChange={mutate} />} /></View>;

  return <View style={styles.fill}>
    <View style={styles.header}><Button label="Close" onPress={() => navigation.goBack()} variant="ghost" /><View style={styles.headerTitle}><Text numberOfLines={1} weight="semibold">{normalized.name || "New form"}</Text><Text tone="muted" variant="caption">{dirty ? "Unsaved changes" : "All changes saved"}</Text></View><StatusBadge label={`${normalized.fields.length} fields`} /></View>
    <View style={styles.toolbar}><Button label="Routes" onPress={() => setMode("routes")} variant="ghost" /><Button label="Preview" onPress={() => setMode("preview")} variant="secondary" /><Button busy={busy === "save"} label={template?.lifecycle === "published" ? "Save changes" : "Save draft"} onPress={() => void save(false)} />{template?.lifecycle !== "published" ? <Button busy={busy === "publish"} label="Publish" onPress={() => void save(true)} variant="secondary" /> : null}</View>
    <FlatList
      contentContainerStyle={styles.list}
      data={normalized.fields}
      keyExtractor={(field) => field.key}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={styles.top}><TextField label="Form name" onChangeText={(name) => mutate({ ...definition, name })} placeholder="e.g. Customer onboarding" value={definition.name} /><TextField label="Description" multiline onChangeText={(description) => mutate({ ...definition, description })} value={definition.description ?? ""} />{message ? <Banner tone={message.includes("saved") || message.includes("published") ? "success" : "danger"}>{message}</Banner> : null}{issues.length ? <Banner tone="warning">{`${issues.length} setting${issues.length === 1 ? "" : "s"} need attention before save.`}</Banner> : null}<SectionEditor definition={definition} onChange={mutate} /><Button label="Add section" onPress={() => mutate(addFormSection(definition))} variant="secondary" /><OptionPicker label="Who can use this form" multiple onChange={(roles) => mutate({ ...definition, permissions: { roles: roles as UserRole[] } })} options={ROLES.map((role) => ({ value: role, label: role.replaceAll("_", " ") }))} selected={definition.permissions?.roles ?? []} /></View>}
      ListEmptyComponent={<Card><Text style={styles.center} tone="muted">No questions yet. Add the first field below.</Text></Card>}
      renderItem={({ item, index }) => <Card accessibilityLabel={`Edit ${item.label}`} onPress={() => setSelectedKey(item.key)}><View style={styles.row}><View style={styles.grow}><Text weight="semibold">{item.label || "Untitled field"}</Text><Text tone="muted" variant="caption">{FIELD_TYPES.find((type) => type.value === item.type)?.label ?? item.type} · {item.required ? "Required" : "Optional"}</Text></View><StatusBadge label={`${index + 1}`} /></View><View style={styles.actions}><Button label="Move up" onPress={() => mutate(moveFormField(definition, item.key, -1))} variant="ghost" /><Button label="Move down" onPress={() => mutate(moveFormField(definition, item.key, 1))} variant="ghost" /><Button label="Duplicate" onPress={() => mutate(duplicateFormField(definition, item.key))} variant="ghost" /><Button label="Delete" onPress={() => Alert.alert("Delete question?", `Delete ${item.label || "this question"}? Referencing conditions will be cleaned safely.`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => mutate(removeFormField(definition, item.key)) }])} variant="danger" /></View></Card>}
      ListFooterComponent={<View style={styles.footer}><Button full label="Add question" onPress={() => setAdding(true)} size="large" /></View>}
    />
    <Sheet onClose={() => setAdding(false)} title="Add question" visible={adding}>{FIELD_TYPES.map((type) => <Button key={type.value} label={type.label} onPress={() => { const section = normalized.fields.at(-1)?.sectionKey ?? normalized.sections?.[0]?.key ?? "section_1"; const field = createFormField(type.value, normalized.fields, section); mutate(insertFormField(normalized, field, normalized.fields.at(-1)?.key)); setAdding(false); setSelectedKey(field.key); }} variant="secondary" />)}</Sheet>
    <FieldEditor definition={definition} dynamicOptions={dynamicOptions} field={selected} onChange={mutate} onClose={() => setSelectedKey(null)} />
  </View>;
}

function SectionEditor({ definition, onChange }: Readonly<{ definition: FormTemplateDefinition; onChange: (value: FormTemplateDefinition) => void }>) {
  return <View>{(definition.sections ?? []).map((section, index) => <View key={section.key}><TextField label={`Section ${index + 1} title`} onChangeText={(title) => onChange(updateFormSection(definition, section.key, { title }))} value={section.title} /><TextField label="Section description" onChangeText={(description) => onChange(updateFormSection(definition, section.key, { description }))} value={section.description ?? ""} /><View style={{ flexDirection: "row", flexWrap: "wrap" }}><Button label="Section up" onPress={() => onChange(moveFormSection(definition, section.key, -1))} variant="ghost" /><Button label="Section down" onPress={() => onChange(moveFormSection(definition, section.key, 1))} variant="ghost" />{(definition.sections?.length ?? 0) > 1 ? <Button label="Remove section" onPress={() => Alert.alert("Remove section?", "Questions in this section and routes to it will be removed.", [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => onChange(removeFormSection(definition, section.key)) }])} variant="danger" /> : null}</View></View>)}</View>;
}

function FieldEditor({ definition, dynamicOptions, field, onChange, onClose }: Readonly<{ definition: FormTemplateDefinition; dynamicOptions: Awaited<ReturnType<typeof loadFormDynamicOptions>>; field: FormFieldDefinition | undefined; onChange: (value: FormTemplateDefinition) => void; onClose: () => void }>) {
  const earlier = field ? definition.fields.slice(0, definition.fields.findIndex((item) => item.key === field.key)).filter((item) => !LAYOUT_FIELD_TYPES.has(item.type)) : [];
  if (!field) return null;
  const patch = (value: Partial<FormFieldDefinition>) => onChange(updateFormField(definition, field.key, value));
  const staticOptions = field.options ?? [];
  const optionText = staticOptions.map((option) => option.label).join("\n");
  const condition = field.rule?.kind === "predicate" ? field.rule : undefined;
  return <Sheet onClose={onClose} tall title={`Edit ${field.label || "question"}`} visible>
    <TextField label="Question label" onChangeText={(label) => patch({ label })} value={field.label} />
    <OptionPicker label="Field type" onChange={(value) => { const type = value[0] as FormFieldType; onChange({ ...definition, fields: convertFormFieldType(definition.fields, definition.fields.findIndex((item) => item.key === field.key), type).fields }); }} options={FIELD_TYPES} selected={[field.type]} />
    <OptionPicker label="Section" onChange={(value) => patch({ sectionKey: value[0] })} options={(definition.sections ?? []).map((section) => ({ value: section.key, label: section.title }))} selected={field.sectionKey ? [field.sectionKey] : []} />
    <TextField label="Helper text" onChangeText={(helperText) => patch({ helperText })} value={field.helperText ?? ""} />
    <TextField label="Placeholder" onChangeText={(placeholder) => patch({ placeholder })} value={field.placeholder ?? ""} />
    <Button label={field.required ? "Required: yes" : "Required: no"} onPress={() => patch({ required: !field.required })} variant="secondary" />
    {["text", "textarea"].includes(field.type) ? <><TextField keyboardType="number-pad" label="Minimum length" onChangeText={(value) => patch({ validation: { ...field.validation, minLength: numberOrUndefined(value) } })} value={field.validation?.minLength?.toString() ?? ""} /><TextField keyboardType="number-pad" label="Maximum length" onChangeText={(value) => patch({ validation: { ...field.validation, maxLength: numberOrUndefined(value) } })} value={field.validation?.maxLength?.toString() ?? ""} /></> : null}
    {["number", "currency", "rating"].includes(field.type) ? <><TextField keyboardType="numeric" label="Minimum value" onChangeText={(value) => patch({ validation: { ...field.validation, min: numberOrUndefined(value) } })} value={field.validation?.min?.toString() ?? ""} /><TextField keyboardType="numeric" label="Maximum value" onChangeText={(value) => patch({ validation: { ...field.validation, max: numberOrUndefined(value) } })} value={field.validation?.max?.toString() ?? ""} /></> : null}
    {OPTION_FIELD_TYPES.has(field.type) && !field.optionSource ? <TextField helperText="One option per line" label="Choice options" multiline onChangeText={(value) => patch({ options: optionLines(value) })} value={optionText} /> : null}
    {field.type === "select" ? <OptionPicker label="Choice source" onChange={(value) => value[0] === "static" ? patch({ optionSource: undefined, options: field.options?.length ? field.options : [{ value: "option_1", label: "Option 1" }] }) : patch({ optionSource: { kind: "master", masterType: value[0]!.slice(7) }, options: undefined })} options={[{ value: "static", label: "Static choices" }, ...uniqueMasterTypes(dynamicOptions.masters).map((type) => ({ value: `master:${type}`, label: `Dropdown master: ${type}` }))]} selected={[field.optionSource?.kind === "master" ? `master:${field.optionSource.masterType}` : "static"]} /> : null}
    <OptionPicker label="Show this question when" onChange={(value) => patch({ rule: value[0] ? { kind: "predicate", fieldKey: value[0]!, operator: "equals", value: "" } : undefined })} options={[{ value: "", label: "Always show" }, ...earlier.map((item) => ({ value: item.key, label: item.label }))]} selected={condition ? [condition.fieldKey] : [""]} />
    {condition ? <TextField label="Required answer" onChangeText={(value) => patch({ rule: { ...condition, value } })} value={typeof condition.value === "string" ? condition.value : ""} /> : null}
    <Button label="Done" onPress={onClose} />
  </Sheet>;
}

const uniqueMasterTypes = (masters: readonly Readonly<{ masterType: string }>[]) => [...new Set(masters.map((item) => item.masterType))].sort();
const optionLines = (text: string): readonly FormOption[] => {
  const used = new Set<string>();
  return text.split(/\r?\n/).map((label) => label.trim()).filter(Boolean).map((label, index) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `option_${index + 1}`;
    let value = base; for (let suffix = 2; used.has(value); suffix += 1) value = `${base}_${suffix}`; used.add(value);
    return { value, label };
  });
};
const numberOrUndefined = (value: string) => value.trim() === "" || !Number.isFinite(Number(value)) ? undefined : Number(value);

function RouteCard({ definition, field, onChange }: Readonly<{ definition: FormTemplateDefinition; field: FormFieldDefinition; onChange: (value: FormTemplateDefinition) => void }>) {
  const options = field.options ?? [];
  const targets = [{ value: "continue", label: "Continue normally" }, ...(definition.sections ?? []).filter((section) => section.key !== field.sectionKey).map((section) => ({ value: section.key, label: `Go to ${section.title}` })), { value: FORM_SUBMIT_TARGET, label: "Submit form" }];
  return <Card><Text weight="semibold">{field.label}</Text>{options.map((option) => { const current = field.branches?.find((branch) => branch.value === option.value)?.targetSectionKey ?? "continue"; return <OptionPicker key={option.value} label={`When answer is ${option.label}`} onChange={(value) => { const target = value[0] ?? "continue"; const branches = [...(field.branches ?? []).filter((branch) => branch.value !== option.value), ...(target === "continue" ? [] : [{ operator: "equals" as const, value: option.value, targetSectionKey: target }])]; onChange(updateFormField(definition, field.key, { branches: branches.length ? branches : undefined })); }} options={targets} selected={[current]} />; })}</Card>;
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  fill: { flex: 1, backgroundColor: theme.colors.background }, header: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, padding: theme.space.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface }, headerTitle: { flex: 1, minWidth: 0 }, toolbar: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs, padding: theme.space.sm, borderBottomWidth: 1, borderBottomColor: theme.colors.border }, list: { padding: theme.space.md, gap: theme.space.md, paddingBottom: theme.space.xl }, top: { gap: theme.space.md }, row: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm }, grow: { flex: 1, minWidth: 0 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs }, footer: { paddingTop: theme.space.sm }, center: { textAlign: "center" },
}));
