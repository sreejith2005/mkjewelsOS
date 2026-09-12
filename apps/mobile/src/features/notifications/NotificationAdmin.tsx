import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  CONDITION_OPERATORS,
  EVENT_VARIABLES,
  NOTIFICATION_EVENT_TYPES,
  RECIPIENT_TYPES,
  renderTemplate,
  type NotificationChannel,
  type NotificationEventType,
  type RecipientRule,
} from "@jewelos/core";
import {
  archiveRule,
  archiveTemplate,
  loadDeliveryLogs,
  retryDelivery,
  saveRule,
  saveTemplate,
  setRuleEnabled,
} from "@jewelos/data/notifications/api";
import type {
  DeliveryLog,
  NotificationRuleRow,
  NotificationTemplateRow,
  ProviderAvailability,
  RuleDraft,
} from "@jewelos/data/notifications/types";
import { deliveryCanRetry, validateRuleDraft, validateTemplateDraft } from "@jewelos/data/notifications/validation";
import { ToggleField } from "@/forms/ToggleField";
import { errorText } from "@/lib/log";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Pressable } from "@/ui/Pressable";
import { Sheet } from "@/ui/Sheet";
import { Banner, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/**
 * Notification administration — the web `ProviderStatus`, `TemplateManager`,
 * `RuleManager`, and `DeliveryLogs` — on the same audited RPCs. Every rule a
 * form enforces comes from `@jewelos/core`.
 */

const spaced = (value: string) => value.replaceAll("_", " ");
const text = (value: unknown, fallback: string): string => (typeof value === "string" && value.trim() ? value : fallback);
const displayDate = (value: string | null): string => (value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString() : "—");

export function ProviderStatus({ providers }: { providers: readonly ProviderAvailability[] }) {
  const styles = useStyles();
  return (
    <View style={styles.providerGrid}>
      {providers.map((provider, index) => {
        const channel = text(provider.channel, "unknown");
        return (
          <View key={`${channel}-${index}`} style={styles.provider}>
            <Text weight="semibold">{spaced(channel)}</Text>
            <Text tone={provider.is_available ? "success" : "muted"} variant="small" weight="semibold">
              {provider.is_available ? "Available" : "Unavailable"}
            </Text>
            <Text tone="muted" variant="caption">{text(provider.status_reason, "Provider status is unavailable.")}</Text>
          </View>
        );
      })}
    </View>
  );
}

type TemplateDraft = { id?: string; name: string; eventType: NotificationEventType; channel: NotificationChannel; title: string; body: string; link: string; active: boolean };
const emptyTemplate: TemplateDraft = { name: "", eventType: "task_assigned", channel: "in_app", title: "", body: "", link: "", active: true };

export function TemplateManager({ templates, providers, onRefresh }: { templates: readonly NotificationTemplateRow[]; providers: readonly ProviderAvailability[]; onRefresh: () => Promise<void> }) {
  const styles = useStyles();
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const availability = useMemo(() => new Map(providers.map((provider) => [provider.channel, provider.is_available])), [providers]);
  const errors = draft ? validateTemplateDraft(draft.eventType, draft.title, draft.body, draft.link || null) : [];
  const sample = draft ? Object.fromEntries(EVENT_VARIABLES[draft.eventType].map((variable) => [variable, `[${spaced(variable)}]`])) : {};
  const preview = (value: string) => { try { return renderTemplate(value, sample); } catch { return value; } };
  const edit = (template: NotificationTemplateRow) => setDraft({ id: template.id, name: template.name, eventType: template.event_type, channel: template.channel, title: template.title_template, body: template.body_template, link: template.link_url ?? "", active: template.is_active ?? true });
  const submit = async () => {
    if (!draft || errors.length) return;
    setBusy(true); setError(null);
    try {
      await saveTemplate({ ...(draft.id ? { id: draft.id } : {}), name: draft.name, event_type: draft.eventType, channel: draft.channel, title_template: draft.title, body_template: draft.body, link_url: draft.link || null, is_active: draft.active });
      setDraft(null);
      await onRefresh();
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  };
  const archive = (template: NotificationTemplateRow) => {
    setBusy(true);
    void archiveTemplate(template.id).then(onRefresh).catch((caught: unknown) => setError(errorText(caught))).finally(() => setBusy(false));
  };

  return (
    <View style={styles.section}>
      <Button label="New template" onPress={() => setDraft(emptyTemplate)} />
      {templates.map((template) => (
        <Card key={template.id}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text weight="semibold">{template.name}</Text>
              <Text tone="muted" variant="caption">{`${spaced(template.event_type)} · ${template.channel}`}</Text>
            </View>
            <StatusBadge label={template.lifecycle} tone={template.lifecycle === "active" ? "success" : "neutral"} />
          </View>
          <Text weight="semibold">{template.title_template}</Text>
          <Text numberOfLines={2} tone="muted" variant="small">{template.body_template}</Text>
          <View style={styles.actions}>
            <Button label="Edit" onPress={() => edit(template)} variant="secondary" />
            {template.lifecycle === "active" ? <Button disabled={busy} label="Archive" onPress={() => archive(template)} variant="ghost" /> : null}
          </View>
        </Card>
      ))}
      {templates.length === 0 ? <Banner tone="info">No templates have been configured.</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {draft ? (
        <Sheet scrollable={false} onClose={() => setDraft(null)} tall title={draft.id ? "Edit notification template" : "New notification template"} visible>
          <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
            <TextField label="Name" onChangeText={(name) => setDraft({ ...draft, name })} value={draft.name} />
            <OptionPicker label="Event" onChange={(values) => setDraft({ ...draft, eventType: (values[0] ?? draft.eventType) as NotificationEventType })} options={NOTIFICATION_EVENT_TYPES.map((event) => ({ value: event, label: spaced(event) }))} selected={[draft.eventType]} />
            <OptionPicker
              label="Channel"
              onChange={(values) => setDraft({ ...draft, channel: (values[0] ?? draft.channel) as NotificationChannel })}
              options={providers.map((provider) => ({ value: provider.channel, label: `${provider.channel}${provider.is_available ? "" : " (unavailable)"}` }))}
              selected={[draft.channel]}
            />
            <TextField label="Title" maxLength={200} onChangeText={(title) => setDraft({ ...draft, title })} value={draft.title} />
            <TextField label="Body" maxLength={4000} multiline onChangeText={(body) => setDraft({ ...draft, body })} value={draft.body} />
            <TextField autoCapitalize="none" label="Safe internal link" onChangeText={(link) => setDraft({ ...draft, link })} placeholder="/tasks/checklist" value={draft.link} />
            <Text tone="muted" variant="label">Allowed variables</Text>
            <View style={styles.chips}>
              {EVENT_VARIABLES[draft.eventType].map((variable) => (
                <Pressable accessibilityLabel={`Insert ${variable}`} accessibilityRole="button" key={variable} onPress={() => setDraft({ ...draft, body: `${draft.body}{{${variable}}}` })} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
                  <Text variant="caption">{`{{${variable}}}`}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.preview}>
              <Text tone="muted" variant="caption" weight="semibold">SAFE PREVIEW</Text>
              <Text weight="semibold">{preview(draft.title)}</Text>
              <Text tone="muted" variant="small">{preview(draft.body)}</Text>
            </View>
            {errors.length ? <Banner tone="danger">{errors.join(" · ")}</Banner> : null}
            {!availability.get(draft.channel) ? <Banner tone="info">This channel is unavailable until a server-side provider is configured.</Banner> : null}
            <Button busy={busy} disabled={errors.length > 0 || !draft.name.trim() || !availability.get(draft.channel)} full label="Save template" onPress={() => void submit()} />
            <Button full label="Cancel" onPress={() => setDraft(null)} variant="ghost" />
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}

const ROLES = ["super_admin", "admin", "manager", "hr", "crm", "staff", "doer", "housekeeping"];
const NO_VALUE_OPERATORS = ["is_empty", "is_not_empty", "is_today", "is_past", "is_future"];
const emptyRule: RuleDraft = { name: "", eventType: "task_assigned", conditions: [], recipients: [{ type: "assigned_users" }], channelTemplates: {}, delayMinutes: 0, cooldownMinutes: 0, maxAttempts: 3, backoffMinutes: 5, priority: "medium", enabled: true };
const asArray = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : []);
const asObject = (value: unknown): Record<string, string> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {});
const NUMBER_FIELDS = [["Delay minutes", "delayMinutes"], ["Cooldown minutes", "cooldownMinutes"], ["Max attempts", "maxAttempts"], ["Backoff minutes", "backoffMinutes"]] as const;

export function RuleManager({ rules, templates, providers, profiles, onRefresh }: { rules: readonly NotificationRuleRow[]; templates: readonly NotificationTemplateRow[]; providers: readonly ProviderAvailability[]; profiles: readonly { id: string; employee_name: string; user_role: string }[]; onRefresh: () => Promise<void> }) {
  const styles = useStyles();
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const availableChannels = useMemo(() => new Set(providers.filter((provider) => provider.is_available).map((provider) => provider.channel)), [providers]);
  const edit = (rule: NotificationRuleRow) => setDraft({
    id: rule.id,
    name: rule.name,
    eventType: rule.event_type,
    conditions: asArray(rule.conditions).map((item) => ({ field: String(item.field ?? ""), operator: String(item.operator ?? "equals"), ...(item.value === undefined ? {} : { value: String(item.value) }) })),
    recipients: asArray(rule.recipient_rules).map((item) => ({ type: String(item.type) as RecipientRule["type"], ...(Array.isArray(item.user_ids) ? { userIds: item.user_ids.map(String) } : {}), ...(typeof item.role === "string" ? { role: item.role } : {}) })),
    channelTemplates: asObject(rule.channel_templates),
    delayMinutes: rule.delay_minutes,
    cooldownMinutes: rule.cooldown_minutes,
    maxAttempts: rule.max_attempts,
    backoffMinutes: rule.backoff_minutes,
    priority: rule.priority,
    enabled: rule.is_active ?? false,
  });
  const errors = draft ? validateRuleDraft(draft) : [];
  const submit = async () => {
    if (!draft || errors.length) return;
    setBusy(true); setError(null);
    try { await saveRule(draft); setDraft(null); await onRefresh(); }
    catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  };
  const updateRecipient = (type: string) => {
    if (!draft) return;
    const recipient: RecipientRule = type === "specified_users" ? { type: "specified_users", userIds: [] } : type === "specified_role" ? { type: "specified_role", role: "manager" } : { type: type as RecipientRule["type"] };
    setDraft({ ...draft, recipients: [recipient] });
  };
  const toggle = (rule: NotificationRuleRow) =>
    void setRuleEnabled(rule.id, !rule.is_active).then(onRefresh).catch((caught: unknown) => setError(errorText(caught)));
  const currentRecipient = draft?.recipients[0];
  const eligibleTemplates = draft ? templates.filter((template) => template.event_type === draft.eventType && template.lifecycle === "active" && template.is_active && availableChannels.has(template.channel)) : [];

  return (
    <View style={styles.section}>
      <Button label="New rule" onPress={() => setDraft(emptyRule)} />
      {rules.map((rule) => (
        <Card key={rule.id}>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text weight="semibold">{rule.name}</Text>
              <Text tone="muted" variant="caption">{`${spaced(rule.event_type)} · ${Object.keys(asObject(rule.channel_templates)).join(", ") || "No channel"}`}</Text>
            </View>
            <Button disabled={rule.lifecycle === "archived"} label={rule.is_active ? "Enabled" : "Disabled"} onPress={() => toggle(rule)} variant={rule.is_active ? "secondary" : "ghost"} />
          </View>
          <View style={styles.actions}>
            <Button label="Edit" onPress={() => edit(rule)} variant="secondary" />
            {rule.lifecycle === "active" ? <Button label="Archive" onPress={() => void archiveRule(rule.id).then(onRefresh).catch((caught: unknown) => setError(errorText(caught)))} variant="ghost" /> : null}
          </View>
        </Card>
      ))}
      {rules.length === 0 ? <Banner tone="info">No notification rules have been configured.</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {draft ? (
        <Sheet scrollable={false} onClose={() => setDraft(null)} tall title={draft.id ? "Edit notification rule" : "New notification rule"} visible>
          <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
            <TextField label="Name" onChangeText={(name) => setDraft({ ...draft, name })} value={draft.name} />
            <OptionPicker label="Event" onChange={(values) => setDraft({ ...draft, eventType: (values[0] ?? draft.eventType) as NotificationEventType, conditions: [], channelTemplates: {} })} options={NOTIFICATION_EVENT_TYPES.map((event) => ({ value: event, label: spaced(event) }))} selected={[draft.eventType]} />
            <OptionPicker label="Recipient resolution" onChange={(values) => updateRecipient(values[0] ?? "")} options={RECIPIENT_TYPES.map((type) => ({ value: type, label: spaced(type) }))} selected={currentRecipient ? [currentRecipient.type] : []} />
            {currentRecipient?.type === "specified_users" ? (
              <OptionPicker
                label="Active users"
                multiple
                onChange={(values) => setDraft({ ...draft, recipients: [{ type: "specified_users", userIds: [...values] }] })}
                options={profiles.map((profile) => ({ value: profile.id, label: `${profile.employee_name} · ${profile.user_role}` }))}
                selected={[...(currentRecipient.userIds ?? [])]}
              />
            ) : null}
            {currentRecipient?.type === "specified_role" ? (
              <OptionPicker label="Active role in event scope" onChange={(values) => setDraft({ ...draft, recipients: [{ type: "specified_role", role: values[0] ?? "manager" }] })} options={ROLES.map((role) => ({ value: role, label: spaced(role) }))} selected={[currentRecipient.role ?? ""]} />
            ) : null}
            <View style={styles.row}>
              <Text style={styles.flex} tone="muted" variant="label">Conditions · all must match</Text>
              <Button label="Add" onPress={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: EVENT_VARIABLES[draft.eventType][0] ?? "", operator: "equals", value: "" }] })} variant="secondary" />
            </View>
            {draft.conditions.map((condition, index) => (
              <View key={`${condition.field}-${index}`} style={styles.condition}>
                <OptionPicker label="Field" onChange={(values) => setDraft({ ...draft, conditions: draft.conditions.map((item, i) => (i === index ? { ...item, field: values[0] ?? item.field } : item)) })} options={EVENT_VARIABLES[draft.eventType].map((field) => ({ value: field, label: field }))} selected={[condition.field]} />
                <OptionPicker label="Operator" onChange={(values) => setDraft({ ...draft, conditions: draft.conditions.map((item, i) => (i === index ? { ...item, operator: values[0] ?? item.operator } : item)) })} options={CONDITION_OPERATORS.map((operator) => ({ value: operator, label: operator }))} selected={[condition.operator]} />
                <TextField editable={!NO_VALUE_OPERATORS.includes(condition.operator)} label="Value" onChangeText={(value) => setDraft({ ...draft, conditions: draft.conditions.map((item, i) => (i === index ? { ...item, value } : item)) })} value={condition.value ?? ""} />
                <Button label="Remove condition" onPress={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, i) => i !== index) })} variant="ghost" />
              </View>
            ))}
            <OptionPicker
              label="Channel and template"
              onChange={(values) => {
                const template = templates.find((item) => item.id === values[0]);
                setDraft({ ...draft, channelTemplates: template ? { [template.channel]: template.id } : {} });
              }}
              options={eligibleTemplates.map((template) => ({ value: template.id, label: `${template.channel} · ${template.name}` }))}
              placeholder="Select an available template"
              selected={[Object.values(draft.channelTemplates)[0] ?? ""]}
            />
            <Text tone="muted" variant="caption">External channels stay disabled until provider availability is confirmed by the server.</Text>
            {NUMBER_FIELDS.map(([label, key]) => (
              <TextField keyboardType="number-pad" key={key} label={label} onChangeText={(value) => setDraft({ ...draft, [key]: Number(value) })} value={String(draft[key])} />
            ))}
            <OptionPicker label="Priority" onChange={(values) => setDraft({ ...draft, priority: (values[0] ?? draft.priority) as RuleDraft["priority"] })} options={["high", "medium", "low"].map((value) => ({ value, label: value }))} selected={[draft.priority]} />
            <ToggleField disabled={false} label="Enable after save" onChange={(enabled) => setDraft({ ...draft, enabled })} required={false} value={draft.enabled} />
            {errors.length ? <Banner tone="danger">{errors.join(" · ")}</Banner> : null}
            <Button busy={busy} disabled={errors.length > 0 || !draft.name.trim()} full label="Save rule" onPress={() => void submit()} />
            <Button full label="Cancel" onPress={() => setDraft(null)} variant="ghost" />
          </ScrollView>
        </Sheet>
      ) : null}
    </View>
  );
}

const DELIVERY_STATES = ["pending", "scheduled", "processing", "delivered", "retry_wait", "failed_terminal", "blocked_configuration", "cancelled"];
const DELIVERY_CHANNELS = ["in_app", "email", "whatsapp", "sms", "push"];

export function DeliveryLogs() {
  const styles = useStyles();
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [state, setState] = useState("");
  const [channel, setChannel] = useState("");
  const [eventType, setEventType] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const refresh = async () => {
    setLoading(true); setError(null);
    try { setLogs(await loadDeliveryLogs({ state, channel, eventType, search })); }
    catch (caught) { setError(errorText(caught)); } finally { setLoading(false); }
  };
  // The web loads once and then waits for Apply; so does this.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, []);
  const retry = (log: DeliveryLog) => {
    setRetrying(log.delivery_id);
    void retryDelivery(log.delivery_id).then(refresh).catch((caught: unknown) => setError(errorText(caught))).finally(() => setRetrying(null));
  };

  return (
    <View style={styles.section}>
      <OptionPicker label="Delivery state" onChange={(values) => setState(values[0] ?? "")} options={[{ value: "", label: "All states" }, ...DELIVERY_STATES.map((value) => ({ value, label: value }))]} selected={[state]} />
      <OptionPicker label="Delivery channel" onChange={(values) => setChannel(values[0] ?? "")} options={[{ value: "", label: "All channels" }, ...DELIVERY_CHANNELS.map((value) => ({ value, label: value }))]} selected={[channel]} />
      <TextField autoCapitalize="none" label="Event type" onChangeText={setEventType} placeholder="Event type" value={eventType} />
      <TextField autoCapitalize="none" label="Search delivery logs" onChangeText={setSearch} placeholder="Delivery ID or event" value={search} />
      <Button label="Apply" onPress={() => void refresh()} variant="secondary" />
      {loading ? <LoadingState label="Loading delivery logs…" />
        : error ? <Banner tone="danger">{error}</Banner>
          : logs.length === 0 ? <Banner tone="info">No delivery logs match these filters.</Banner>
            : logs.map((log) => (
              <Card key={log.delivery_id}>
                <Text weight="semibold">{typeof log.event_type === "string" ? spaced(log.event_type) : "system"}</Text>
                <CardRow label="Recipient" value={typeof log.recipient_label === "string" ? log.recipient_label : "—"} />
                <CardRow label="Channel" value={typeof log.channel === "string" ? log.channel : "unknown"} />
                <CardRow label="State" value={typeof log.state === "string" ? log.state : "unknown"} />
                <CardRow label="Attempts" value={`${log.attempt_count}/${log.max_attempts}`} />
                <CardRow label="Safe error" value={log.error_category ?? "—"} />
                <CardRow label="Created" value={displayDate(log.created_at)} />
                {deliveryCanRetry(log.state) ? <Button disabled={retrying === log.delivery_id} label="Retry" onPress={() => retry(log)} variant="ghost" /> : null}
              </Card>
            ))}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  section: { gap: theme.space.sm },
  editor: { gap: theme.space.md, paddingBottom: theme.space.md },
  row: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  flex: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  providerGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  provider: {
    flexGrow: 1,
    flexBasis: "45%",
    gap: 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    padding: theme.space.sm,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  chip: { borderRadius: theme.radius.pill, backgroundColor: theme.colors.background, paddingHorizontal: theme.space.sm, paddingVertical: 4 },
  pressed: { opacity: 0.7 },
  preview: { gap: 4, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: theme.space.sm },
  condition: { gap: theme.space.xs, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.space.sm },
}));
