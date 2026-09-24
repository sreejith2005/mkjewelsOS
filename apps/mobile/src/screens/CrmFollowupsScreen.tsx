import { useCallback, useState, type ReactNode } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { validateCrmFollowupDraft } from "@jewelos/core";
import { cancelFollowup, completeFollowup, loadCrmOptions, loadFollowups, rescheduleFollowup } from "@jewelos/data/crm/api";
import type { CrmFollowup, CrmOptions } from "@jewelos/data/crm/types";
import { useAuth } from "@/auth/AuthProvider";
import { DateField } from "@/forms/DateField";
import { ToggleField } from "@/forms/ToggleField";
import { formatDate } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Bucket = "today" | "overdue" | "upcoming" | "completed";

/** `header` lets the CRM workspace show this queue as its "Not bought follow-up" section. */
export function CrmFollowupsScreen({ header }: Readonly<{ header?: ReactNode }> = {}) {
  const { profile } = useAuth(); const theme = useAppTheme(); const styles = useStyles(); const navigation = useNavigation<Navigation>();
  const [bucket, setBucket] = useState<Bucket>("today"); const [mine, setMine] = useState(true); const [action, setAction] = useState<{ item: CrmFollowup; kind: "reschedule" | "complete" | "cancel" } | null>(null);
  const load = useCallback(async () => { const [items, options] = await Promise.all([loadFollowups({ bucket, assigned_to: mine ? profile?.id : undefined, branch_id: profile?.user_role === "manager" ? profile.branch_id : undefined, limit: 100 }), loadCrmOptions()]); return { items, options }; }, [bucket, mine, profile]);
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  if (loading && !data) return <Screen scroll>{header}<LoadingState label="Loading follow-ups…" /></Screen>;
  if (error && !data) return <Screen scroll>{header}<ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  return <Screen refreshControl={<RefreshControl colors={[theme.colors.primary]} refreshing={refreshing} onRefresh={() => void refresh()} />} scroll>
    {header}
    <View style={styles.heading}><View style={styles.headingCopy}><Text variant="title" weight="semibold">Follow-ups</Text><Text tone="muted" variant="small">Tenant-timezone queues and PostgreSQL-authoritative transitions.</Text></View><Button label="Refresh" onPress={() => void refresh()} variant="secondary" /></View>
    <SegmentedControl accessibilityLabel="Follow-up queue" options={[{ value: "today", label: "Today" }, { value: "overdue", label: "Overdue" }, { value: "upcoming", label: "Upcoming" }, { value: "completed", label: "Completed" }]} value={bucket} onChange={(value) => setBucket(value as Bucket)} />
    <ToggleField label="Assigned to me" value={mine} disabled={false} required={false} onChange={setMine} />
    {error ? <Text tone="danger">{error}</Text> : null}
    {data?.items.length ? data.items.map((item) => <Card key={item.id} onPress={() => navigation.navigate("ClientDetail", { clientId: item.client_id })}><Text weight="semibold">{item.client_display ?? "Authorized client"}</Text><Text tone="muted">{item.subject ?? "Follow-up"} · due {formatDate(item.due_date)}</Text><StatusBadge label={item.status} tone={item.status === "open" ? "primary" : "neutral"} />{item.status === "open" ? <View style={styles.actions}><Button label="Reschedule" variant="secondary" onPress={() => setAction({ item, kind: "reschedule" })} /><Button label="Complete" onPress={() => setAction({ item, kind: "complete" })} /><Button label="Cancel" variant="danger" onPress={() => setAction({ item, kind: "cancel" })} /></View> : null}</Card>) : <EmptyState title="No follow-ups" message="No follow-ups in this queue." />}
    {action && data ? <FollowupAction action={action} options={data.options} close={() => setAction(null)} done={async () => { setAction(null); await refresh(); }} /> : null}
  </Screen>;
}

function FollowupAction({ action, options, close, done }: { action: { item: CrmFollowup; kind: "reschedule" | "complete" | "cancel" }; options: CrmOptions; close: () => void; done: () => Promise<void> }) {
  const [due, setDue] = useState(action.item.due_date); const [assigned, setAssigned] = useState(action.item.assigned_to ?? ""); const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async () => { const invalid = validateCrmFollowupDraft({ action: action.kind, actionText: text, dueDate: due, assignedTo: assigned }); if (invalid) { setError(invalid); return; } setBusy(true); try { if (action.kind === "reschedule") await rescheduleFollowup(action.item.id, due, assigned, text, action.item.record_version); else if (action.kind === "complete") await completeFollowup(action.item.id, text, action.item.record_version); else await cancelFollowup(action.item.id, text, action.item.record_version); await done(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Follow-up action failed."); setBusy(false); } };
  return <Sheet visible title={`${action.kind[0]?.toUpperCase()}${action.kind.slice(1)} follow-up`} onClose={close}>{error ? <Text tone="danger">{error}</Text> : null}{action.kind === "reschedule" ? <><DateField label="New due date" mode="date" value={due} disabled={busy} invalid={!due} onChange={setDue} /><OptionPicker label="Assignee" options={options.profiles.map((item) => ({ value: item.id, label: item.label }))} selected={assigned ? [assigned] : []} onChange={(ids) => setAssigned(ids[0] ?? "")} /></> : null}<TextField label={action.kind === "complete" ? "Outcome" : "Reason"} multiline required value={text} onChangeText={setText} /><Button full busy={busy} label="Confirm" onPress={() => void submit()} /></Sheet>;
}
const useStyles = makeStyles((theme) => StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs, marginTop: theme.space.sm },
  heading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm },
  headingCopy: { flex: 1, minWidth: 0, gap: 2 },
}));
