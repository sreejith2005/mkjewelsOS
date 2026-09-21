import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { crmStaleEditMessage, normalizeClientInput, validateCrmClientDraft } from "@jewelos/core";
import { createClient, loadClient, loadCrmOptions, lookupClient, updateClient } from "@jewelos/data/crm/api";
import { DateField } from "@/forms/DateField";
import { ToggleField } from "@/forms/ToggleField";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { Button } from "@/ui/Button";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Route = RouteProp<RootStackParamList, "ClientEditor">;
type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Form = Record<"first_name" | "last_name" | "primary_phone" | "billing_phone" | "email" | "gender" | "date_of_birth" | "anniversary_date" | "address" | "city" | "state" | "pincode" | "source_id" | "client_type_id" | "potential_category" | "assigned_crm_id" | "branch_id" | "status" | "communication_preference" | "tags", string> & { communication_consent: boolean };
const blank: Form = { first_name: "", last_name: "", primary_phone: "", billing_phone: "", email: "", gender: "", date_of_birth: "", anniversary_date: "", address: "", city: "", state: "", pincode: "", source_id: "", client_type_id: "", potential_category: "", assigned_crm_id: "", branch_id: "", status: "active", communication_preference: "", tags: "", communication_consent: false };

export function ClientEditorScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation<Navigation>();
  const clientId = params?.clientId;
  const [form, setForm] = useState<Form>(blank);
  const [version, setVersion] = useState(0);
  const [options, setOptions] = useState<Awaited<ReturnType<typeof loadCrmOptions>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  useUnsavedGuard(dirty && !busy, "Discard client changes?", "Your unsaved client details will be lost.");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextOptions, detail] = await Promise.all([loadCrmOptions(), clientId ? loadClient(clientId) : Promise.resolve(null)]);
      setOptions(nextOptions);
      if (detail) {
        const c = detail.client;
        setForm({ first_name: c.first_name, last_name: c.last_name ?? "", primary_phone: c.phone, billing_phone: c.billing_phone ?? "", email: c.email ?? "", gender: c.gender ?? "", date_of_birth: c.date_of_birth ?? "", anniversary_date: c.anniversary_date ?? "", address: c.address ?? "", city: c.city ?? "", state: c.state ?? "", pincode: c.pincode ?? "", source_id: c.source_id ?? "", client_type_id: c.client_type_id ?? "", potential_category: c.potential_category ?? "", assigned_crm_id: c.assigned_crm_id ?? "", branch_id: c.branch_id ?? "", status: c.status, communication_preference: c.communication_preference ?? "", tags: c.tags.join(", "), communication_consent: c.communication_consent ?? false });
        setVersion(c.record_version);
      }
    } catch (caught) { setError(crmStaleEditMessage(caught)); } finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setDirty(true); setForm((old) => ({ ...old, [key]: value })); };
  const pick = (label: string, key: keyof Form, items: Array<{ value: string; label: string }>) => <OptionPicker label={label} options={items} selected={form[key] ? [String(form[key])] : []} onChange={(ids) => set(key, (ids[0] ?? "") as never)} />;
  const dropdown = (type: string, values = false) => (options?.dropdowns ?? []).filter((item) => item.master_type === type).map((item) => ({ value: values ? item.value ?? item.label : item.id, label: item.label }));
  const checkPhone = async () => {
    if (!form.primary_phone.trim()) return;
    try { const match = await lookupClient(form.primary_phone); setDuplicate(match && match.client_id !== clientId ? match.client_id : null); } catch (caught) { setError(crmStaleEditMessage(caught)); }
  };
  const save = async () => {
    const invalid = validateCrmClientDraft({ firstName: form.first_name, primaryPhone: form.primary_phone, branchId: form.branch_id });
    if (invalid) { setError(invalid); return; }
    await checkPhone();
    const match = await lookupClient(form.primary_phone);
    if (match && match.client_id !== clientId) { setDuplicate(match.client_id); setError("This phone already belongs to an active client. Open the existing match instead."); return; }
    setBusy(true); setError(null);
    try {
      normalizeClientInput({ firstName: form.first_name, lastName: form.last_name, primaryPhone: form.primary_phone, billingPhone: form.billing_phone, email: form.email, pincode: form.pincode, tags: form.tags.split(",") });
      const payload = { ...form, tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
      const savedId = clientId ? (await updateClient(clientId, payload, version), clientId) : await createClient(payload);
      setDirty(false);
      navigation.replace("ClientDetail", { clientId: savedId });
    } catch (caught) { setError(crmStaleEditMessage(caught)); } finally { setBusy(false); }
  };
  if (loading) return <Screen><LoadingState label="Loading client editor…" /></Screen>;
  if (!options) return <Screen><ErrorState message={error ?? "CRM options are unavailable."} onRetry={() => void load()} /></Screen>;
  const fields: Array<[keyof Form, string, object?]> = [["first_name", "First name"], ["last_name", "Last name"], ["primary_phone", "Primary phone", { keyboardType: "phone-pad", onBlur: () => void checkPhone() }], ["billing_phone", "Billing / alternate phone", { keyboardType: "phone-pad" }], ["email", "Email", { keyboardType: "email-address", autoCapitalize: "none" }], ["city", "City"], ["state", "State"], ["pincode", "Pincode", { keyboardType: "number-pad" }], ["tags", "Tags (comma separated)"], ["address", "Address", { multiline: true }]];
  return <Screen scroll>
    <Text variant="title" weight="semibold">{clientId ? "Edit client" : "Create client"}</Text>
    {error ? <Text tone="danger">{error}</Text> : null}
    {duplicate ? <Button label="Open matching client" variant="secondary" onPress={() => { setDirty(false); navigation.replace("ClientDetail", { clientId: duplicate }); }} /> : null}
    {fields.slice(0, 5).map(([key, label, props]) => <TextField key={key} label={label} required={key === "first_name" || key === "primary_phone"} value={String(form[key])} onChangeText={(value) => { if (key === "primary_phone") setDuplicate(null); set(key, value as never); }} {...props} />)}
    {pick("Gender", "gender", dropdown("gender", true).length ? dropdown("gender", true) : [{ value: "female", label: "Female" }, { value: "male", label: "Male" }, { value: "other", label: "Other" }, { value: "prefer_not_to_say", label: "Prefer not to say" }])}
    <DateField label="Date of birth" mode="date" value={form.date_of_birth} disabled={false} invalid={false} onChange={(value) => set("date_of_birth", value)} />
    <DateField label="Anniversary" mode="date" value={form.anniversary_date} disabled={false} invalid={false} onChange={(value) => set("anniversary_date", value)} />
    {pick("Home branch", "branch_id", options.branches.map((item) => ({ value: item.id, label: item.label })))}
    {pick("Source", "source_id", dropdown("crm_source"))}{pick("Client type", "client_type_id", dropdown("client_type"))}
    {pick("Status", "status", [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }])}
    {pick("Potential category", "potential_category", dropdown("potential_category", true))}
    {pick("Communication preference", "communication_preference", dropdown("communication_preference", true))}
    {pick("Assigned CRM", "assigned_crm_id", options.profiles.filter((item) => ["crm", "manager", "admin", "super_admin"].includes(item.user_role ?? "")).map((item) => ({ value: item.id, label: item.label })))}
    {fields.slice(5).map(([key, label, props]) => <TextField key={key} label={label} value={String(form[key])} onChangeText={(value) => set(key, value as never)} {...props} />)}
    <ToggleField label="Customer has recorded communication consent" value={form.communication_consent} disabled={false} required={false} onChange={(value) => set("communication_consent", value)} />
    <Button full busy={busy} disabled={Boolean(duplicate)} label="Save client" onPress={() => void save()} />
    <Button full label="Cancel" variant="secondary" onPress={() => { if (!dirty) navigation.goBack(); else Alert.alert("Unsaved changes", "Use Back and confirm if you want to discard them."); }} />
  </Screen>;
}
