import { useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { validateWalkinConditional } from "@jewelos/core";
import { lookupClient, recordWalkin, requestKey, uploadCrmDocument } from "@jewelos/data/crm/api";
import type { CrmOptions } from "@jewelos/data/crm/types";
import type { UploadableFile } from "@jewelos/data/runtime";
import { DateField } from "@/forms/DateField";
import { pickFileFromChooser } from "@/lib/pickFile";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { OptionPicker, type PickerOption } from "@/ui/OptionPicker";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Banner } from "@/ui/states";

const CRM_ROLES = ["crm", "manager", "admin", "super_admin"];
const SALES_ROLES = ["staff", "crm", "manager", "admin", "super_admin"];

type WalkinDraft = {
  phone: string; first_name: string; last_name: string; email: string; branch_id: string; assigned_crm_id: string;
  salesperson_id: string; client_type_id: string; source_id: string; visit_at: string; product_bought: "true" | "false";
  buy_status: string; buy_status_id: string; not_bought_reason_id: string; product_requirement: string;
  followup_due_date: string; potential_category_id: string; remark: string; companions: string;
};

const EMPTY: WalkinDraft = {
  phone: "", first_name: "", last_name: "", email: "", branch_id: "", assigned_crm_id: "", salesperson_id: "",
  client_type_id: "", source_id: "", visit_at: "", product_bought: "false", buy_status: "", buy_status_id: "",
  not_bought_reason_id: "", product_requirement: "", followup_due_date: "", potential_category_id: "", remark: "", companions: "0",
};

/**
 * The web `WalkinForm`, field for field. The phone is looked up first so an
 * existing client is never duplicated; `record_crm_walkin` is idempotent on its
 * request key and re-validates every rule on the server.
 */
export function WalkinForm({ options, initialPhone = "", onSaved, onCancel }: Readonly<{
  options: CrmOptions;
  initialPhone?: string;
  onSaved: (clientId: string, summary: string) => void;
  onCancel: () => void;
}>) {
  const styles = useStyles();
  const [form, setForm] = useState<WalkinDraft>({ ...EMPTY, phone: initialPhone });
  const [productCategoryIds, setProductCategoryIds] = useState<readonly string[]>([]);
  const [match, setMatch] = useState<{ client_id: string; match_kind: string } | null>(null);
  const [lookedUp, setLookedUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<UploadableFile | null>(null);
  const mutationKey = useRef(requestKey());

  const set = <K extends keyof WalkinDraft>(key: K, value: WalkinDraft[K]) => setForm((old) => ({ ...old, [key]: value }));
  const dropdown = (type: string): PickerOption[] => options.dropdowns
    .filter((item) => item.master_type === type)
    .map((item) => ({ value: item.id, label: item.label }));
  const people = (roles: readonly string[]): PickerOption[] => options.profiles
    .filter((item) => roles.includes(item.user_role ?? ""))
    .map((item) => ({ value: item.id, label: item.employee_code ? `${item.label} · ${item.employee_code}` : item.label }));
  const crmPeople = people(CRM_ROLES);
  const salesPeople = people(SALES_ROLES);
  const branches = options.branches.map((item) => ({ value: item.id, label: item.label }));

  const lookup = async () => {
    setError(null);
    setLookedUp(false);
    try {
      setMatch(await lookupClient(form.phone));
      setLookedUp(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Lookup failed");
    }
  };

  const chooseAttachment = async () => {
    const picked = await pickFileFromChooser("Optional private attachment");
    if (!picked.ok) {
      if (!picked.cancelled) setError(picked.message);
      return;
    }
    setFile(picked.file);
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    const errors = validateWalkinConditional({
      productBought: form.product_bought === "true",
      buyStatus: form.buy_status,
      notBoughtReason: form.not_bought_reason_id,
      nextFollowupDate: form.followup_due_date,
      companions: Number(form.companions),
    });
    if (!lookedUp) errors.unshift("Look up the phone before recording the walk-in.");
    if (!match && !form.first_name.trim()) errors.push("First name is required for a new client.");
    // The web form marks these required, so the browser refuses to submit without them.
    if (!form.branch_id) errors.push("Visit branch is required.");
    if (!form.buy_status_id) errors.push("Buy status is required.");
    if (errors.length) { setError(errors.join(" ")); return; }
    setBusy(true);
    try {
      const { visit_at: visitAt, ...rest } = form;
      const result = await recordWalkin({
        ...rest,
        ...(visitAt ? { visit_at: visitAt } : {}),
        product_category_ids: productCategoryIds,
        product_bought: form.product_bought === "true",
        companions: Number(form.companions),
      }, mutationKey.current);
      let summary = result.replayed ? "Existing walk-in request reopened." : match ? "Walk-in linked to the existing client." : "Client and walk-in created.";
      if (file) {
        try {
          await uploadCrmDocument(result.client_id, "walkin", result.walkin_id, file);
          summary += " Attachment registered privately.";
        } catch (caught) {
          summary += " Walk-in saved, but the attachment was not registered; the uploaded object was cleaned up.";
          setError(caught instanceof Error ? caught.message : "Attachment failed");
        }
      }
      onSaved(result.client_id, summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Walk-in failed");
    } finally {
      setBusy(false);
    }
  };

  const status = form.buy_status.toLowerCase();
  const notBought = ["not_bought", "lost", "no"].includes(status);
  const followup = ["follow_up", "considering", "not_bought"].includes(status);

  return (
    <View style={styles.form}>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <View style={styles.lookup}>
        <TextField
          keyboardType="phone-pad"
          label="Phone"
          onChangeText={(value) => { set("phone", value); setLookedUp(false); setMatch(null); }}
          required
          value={form.phone}
        />
        <Button full label="Look up" onPress={() => void lookup()} variant="secondary" />
        {lookedUp ? (
          <Text variant="small">
            {match ? `Existing client match (${match.match_kind}). No duplicate will be created.` : "No authorized tenant match. A new client will be created."}
          </Text>
        ) : null}
      </View>

      {!match && lookedUp ? (
        <>
          <TextField autoCapitalize="words" label="First name" onChangeText={(value) => set("first_name", value)} required value={form.first_name} />
          <TextField autoCapitalize="words" label="Last name" onChangeText={(value) => set("last_name", value)} value={form.last_name} />
          <TextField autoCapitalize="none" keyboardType="email-address" label="Email" onChangeText={(value) => set("email", value)} value={form.email} />
        </>
      ) : null}

      <Field label="Visit branch *">
        <OptionPicker label="Visit branch" onChange={(next) => set("branch_id", next[0] ?? "")} options={branches} selected={form.branch_id ? [form.branch_id] : []} />
      </Field>
      <Field label="Visit date and time">
        <DateField disabled={busy} invalid={false} label="Visit date and time" mode="datetime" onChange={(value) => set("visit_at", value)} value={form.visit_at} />
      </Field>
      <Field label="CRM source">
        <OptionPicker label="CRM source" onChange={(next) => set("source_id", next[0] ?? "")} options={dropdown("crm_source")} selected={form.source_id ? [form.source_id] : []} />
      </Field>
      <Field label="Client type">
        <OptionPicker label="Client type" onChange={(next) => set("client_type_id", next[0] ?? "")} options={dropdown("client_type")} selected={form.client_type_id ? [form.client_type_id] : []} />
      </Field>
      <Field label="Product bought *">
        <SegmentedControl
          accessibilityLabel="Product bought"
          onChange={(value) => set("product_bought", value)}
          options={[{ value: "false", label: "No" }, { value: "true", label: "Yes" }]}
          value={form.product_bought}
        />
      </Field>
      <Field label="Buy status *">
        <OptionPicker
          label="Buy status"
          onChange={(next) => {
            const id = next[0] ?? "";
            const item = options.dropdowns.find((option) => option.master_type === "buy_status" && option.id === id);
            setForm((old) => ({ ...old, buy_status_id: id, buy_status: (item?.value ?? item?.label ?? "").toLowerCase().replace(/\s+/g, "_") }));
          }}
          options={dropdown("buy_status")}
          selected={form.buy_status_id ? [form.buy_status_id] : []}
        />
      </Field>
      {notBought ? (
        <Field label="Not-bought reason *">
          <OptionPicker label="Not-bought reason" onChange={(next) => set("not_bought_reason_id", next[0] ?? "")} options={dropdown("not_bought_reason")} selected={form.not_bought_reason_id ? [form.not_bought_reason_id] : []} />
        </Field>
      ) : null}
      {followup ? (
        <Field label="Next follow-up *">
          <DateField disabled={busy} invalid={!form.followup_due_date} label="Next follow-up" mode="date" onChange={(value) => set("followup_due_date", value)} value={form.followup_due_date} />
        </Field>
      ) : null}
      <Field label="Potential category">
        <OptionPicker label="Potential category" onChange={(next) => set("potential_category_id", next[0] ?? "")} options={dropdown("potential_category")} selected={form.potential_category_id ? [form.potential_category_id] : []} />
      </Field>
      <TextField keyboardType="number-pad" label="Companions" maxLength={2} onChangeText={(value) => set("companions", value.replace(/[^0-9]/g, ""))} value={form.companions} />
      <Field label="Assigned CRM">
        <OptionPicker label="Assigned CRM" onChange={(next) => set("assigned_crm_id", next[0] ?? "")} options={crmPeople} selected={form.assigned_crm_id ? [form.assigned_crm_id] : []} />
      </Field>
      <Field label="Salesperson">
        <OptionPicker label="Salesperson" onChange={(next) => set("salesperson_id", next[0] ?? "")} options={salesPeople} selected={form.salesperson_id ? [form.salesperson_id] : []} />
      </Field>
      <Field label="Product categories">
        <OptionPicker label="Product categories" multiple onChange={setProductCategoryIds} options={dropdown("product_category")} selected={productCategoryIds} />
      </Field>
      <TextField label="Product requirement" multiline onChangeText={(value) => set("product_requirement", value)} value={form.product_requirement} />
      <TextField label="Remark (stored as timeline history)" multiline onChangeText={(value) => set("remark", value)} value={form.remark} />
      <Field label="Optional private attachment">
        <Button full label={file ? file.name : "Choose a photo or file"} onPress={() => void chooseAttachment()} variant="secondary" />
      </Field>

      <View style={styles.actions}>
        <Button label="Cancel" onPress={onCancel} variant="secondary" />
        <Button busy={busy} label={busy ? "Recording…" : "Record walk-in"} onPress={() => void submit()} />
      </View>
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text tone="warm" variant="label" weight="medium">{label}</Text>
      {children}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  form: { gap: theme.space.md },
  lookup: {
    gap: theme.space.sm,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    padding: theme.space.md,
  },
  field: { gap: theme.space.xs },
  actions: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: theme.space.sm },
}));
