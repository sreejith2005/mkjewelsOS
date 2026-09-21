import { useCallback, useState } from "react";
import { Linking, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { deriveCrmCapability } from "@jewelos/core";
import { loadClient, loadCrmOptions, removeDocument, signedDocumentUrl, uploadCrmDocument } from "@jewelos/data/crm/api";
import { useAuth } from "@/auth/AuthProvider";
import { ClientActionSheet } from "@/features/crm/ClientActionSheets";
import { formatDate, formatDateTime, titleCase } from "@/lib/format";
import { pickFileFromChooser } from "@/lib/pickFile";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { PromptSheet } from "@/ui/PromptSheet";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Route = RouteProp<RootStackParamList, "ClientDetail">;
type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Tab = "timeline" | "walkins" | "followups" | "documents" | "links";

export function ClientDetailScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const { profile } = useAuth();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const [tab, setTab] = useState<Tab>("timeline");
  const [action, setAction] = useState<"interaction" | "followup" | "reassign" | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [detail, options] = await Promise.all([loadClient(params.clientId), loadCrmOptions()]);
    return { detail, options };
  }, [params.clientId]);
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  if (loading && !data) return <Screen><LoadingState label="Loading the client…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data || !profile) return <Screen><EmptyState message="This client is outside what you are authorised to see." title="Client not available" /></Screen>;
  const { detail, options } = data;
  const { client } = detail;
  const name = [client.first_name, client.last_name].filter(Boolean).join(" ") || "Unnamed client";
  const capability = deriveCrmCapability({ role: profile.user_role, active: !["inactive", "resigned"].includes(profile.working_status), sameBranch: client.branch_id === profile.branch_id, assigned: client.assigned_crm_id === profile.id });
  const linkGroups = [
    { title: "Tasks", items: detail.tasks },
    { title: "Forms", items: detail.forms },
    { title: "FMS", items: detail.fms },
  ];
  const upload = async () => {
    const picked = await pickFileFromChooser("Upload private CRM document");
    if (!picked.ok) { if (!picked.cancelled) setActionError(picked.message); return; }
    setBusy(true);
    try { await uploadCrmDocument(client.id, "client", client.id, picked.file); await refresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : "Upload failed."); }
    finally { setBusy(false); }
  };
  return <Screen refreshControl={<RefreshControl colors={[theme.colors.primary]} refreshing={refreshing} onRefresh={() => void refresh()} />} scroll>
    <View style={styles.header}><Text variant="title" weight="semibold">{name}</Text><View style={styles.badges}><StatusBadge label={`${client.total_visits} visit${client.total_visits === 1 ? "" : "s"}`} /><StatusBadge label={titleCase(client.status)} tone="primary" /></View></View>
    {actionError || error ? <Text tone="danger">{actionError ?? error}</Text> : null}
    <View style={styles.actions}>
      {capability.canLogInteraction ? <Button label="Log interaction" onPress={() => setAction("interaction")} /> : null}
      {capability.canManageFollowups ? <Button label="Follow-up" variant="secondary" onPress={() => setAction("followup")} /> : null}
      {capability.canEditClient ? <Button label="Edit" variant="secondary" onPress={() => navigation.navigate("ClientEditor", { clientId: client.id })} /> : null}
      {capability.canReassignClient ? <Button label="Reassign" variant="secondary" onPress={() => setAction("reassign")} /> : null}
      {capability.canMergeClients ? <Button label="Merge" variant="danger" onPress={() => navigation.navigate("CrmMerge", { survivorId: client.id })} /> : null}
      <Button label="Record walk-in" variant="secondary" onPress={() => navigation.navigate("Walkin", { clientId: client.id })} />
    </View>
    <Card><CardRow label="Phone" value={client.phone} />{client.billing_phone ? <CardRow label="Alternate phone" value={client.billing_phone} /> : null}{client.email ? <CardRow label="Email" value={client.email} /> : null}<CardRow label="Location" value={[client.city, client.state, client.pincode].filter(Boolean).join(", ") || "—"} /><CardRow label="Communication" value={client.communication_preference ?? "—"} /><CardRow label="Consent" value={client.communication_consent === true ? "Recorded" : client.communication_consent === false ? "Not granted" : "Not recorded"} /></Card>
    <SegmentedControl accessibilityLabel="Client sections" options={[{ value: "timeline", label: "Timeline" }, { value: "walkins", label: "Walk-ins" }, { value: "followups", label: "Follow-ups" }, { value: "documents", label: "Documents" }, { value: "links", label: "Links" }]} value={tab} onChange={setTab} />
    {tab === "timeline" ? (detail.timeline.length ? detail.timeline.map((item) => <Card key={item.id}><Text weight="semibold">{item.subject ?? titleCase(item.event_type)}</Text>{item.outcome ?? item.summary ? <Text tone="muted">{item.outcome ?? item.summary}</Text> : null}<Text tone="muted" variant="caption">{formatDateTime(item.occurred_at)}</Text></Card>) : <EmptyState title="No history" message="Nothing has been recorded for this client yet." />) : null}
    {tab === "walkins" ? (detail.walkins.length ? detail.walkins.map((item) => <Card key={item.id}><Text weight="semibold">{formatDateTime(item.visit_date)}</Text><Text tone="muted">{item.product_bought ? "Product bought" : "No purchase recorded"}{item.buy_status ? ` · ${item.buy_status}` : ""}</Text>{item.remark ? <Text>{item.remark}</Text> : null}</Card>) : <EmptyState title="No walk-ins" message="No visits have been recorded." />) : null}
    {tab === "followups" ? (detail.followups.length ? detail.followups.map((item) => <Card key={item.id}><Text weight="semibold">{item.subject ?? "Follow-up"}</Text><Text tone="muted">Due {formatDate(item.due_date)}</Text><StatusBadge label={item.status} />{item.outcome ? <Text>Outcome: {item.outcome}</Text> : null}{item.cancel_reason ? <Text>Cancelled: {item.cancel_reason}</Text> : null}</Card>) : <EmptyState title="No follow-ups" message="No follow-up history is recorded." />) : null}
    {tab === "documents" ? <>{capability.canManageDocuments ? <Button full busy={busy} label="Upload private document" onPress={() => void upload()} /> : null}{detail.documents.length ? detail.documents.map((item) => <Card key={item.id}><Text weight="semibold">{item.original_filename}</Text><Text tone="muted" variant="caption">{item.mime_type} · {Math.ceil(item.size_bytes / 1024)} KB</Text><View style={styles.actions}><Button label="View" variant="secondary" onPress={() => void signedDocumentUrl(item.id).then((url) => Linking.openURL(url)).catch((caught) => setActionError(caught instanceof Error ? caught.message : "Document access failed."))} />{capability.canManageDocuments ? <Button label="Remove" variant="danger" onPress={() => setRemoveId(item.id)} /> : null}</View></Card>) : <EmptyState title="No documents" message="No private documents are attached." />}</> : null}
    {tab === "links" ? <>{linkGroups.map(({ title, items }) => <Card key={title}><Text weight="semibold">{title}</Text>{items.length ? items.map((item) => <Text key={item.id}>{item.title ?? item.reference_number ?? item.form_template_id ?? "Linked record"} · {item.status}</Text>) : <Text tone="muted">No linked {title.toLowerCase()}.</Text>}</Card>)}</> : null}
    <ClientActionSheet key={action ?? "none"} kind={action} detail={detail} options={options} defaultAssignee={client.assigned_crm_id ?? profile.id} close={() => setAction(null)} done={async () => { setAction(null); await refresh(); }} />
    <PromptSheet visible={Boolean(removeId)} title="Reason for removing this document" submitLabel="Remove" busy={busy} onCancel={() => setRemoveId(null)} onSubmit={(reason) => { if (!removeId) return; setBusy(true); void removeDocument(removeId, reason).then(async () => { setRemoveId(null); await refresh(); }).catch((caught) => setActionError(caught instanceof Error ? caught.message : "Removal failed.")).finally(() => setBusy(false)); }} />
  </Screen>;
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { gap: theme.space.xs },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
}));
