import { useEffect, useMemo, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { FileText } from "lucide-react-native";
import { archiveForm, duplicateForm, loadForms, publishAsNewForm, publishForm, type FormBundle } from "@jewelos/data/forms/api";
import { hasPermission } from "@jewelos/core";
import { useAuth } from "@/auth/AuthProvider";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { FormLifecycleActions } from "@/features/forms/FormLifecycleActions";
import { groupSubmissions } from "@/features/forms/submissionModel";
import { formatDateTime, titleCase } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import type { RootStackParamList } from "@/navigation/types";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Pressable } from "@/ui/Pressable";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Tab = "templates" | "submissions";

const PINNED_BY_FMS = "Publish form: Form version is pinned by an active FMS stage";

function confirm(title: string, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/**
 * The web Forms Library: form families with their versions, and the viewer's
 * submissions grouped by form. Every lifecycle action is an audited RPC that
 * re-checks `forms.manage`.
 */
export function FormsLibraryScreen() {
  const navigation = useNavigation<Navigation>();
  const { access, profile } = useAuth();
  const theme = useAppTheme();
  const styles = useStyles();
  const [tab, setTab] = useState<Tab>("templates");
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<FormBundle | null>(null);
  const { data, error, loading, refreshing, refresh, reload } = useAsyncData(loadForms, []);
  useEffect(() => profile?.tenant_id ? subscribeToTenantRealtime(profile.tenant_id, ["forms", "tasks", "fms", "organization"], () => void refresh()) : undefined, [profile?.tenant_id, refresh]);

  // One card per form family, newest version first, as the web library lists them.
  const families = useMemo(() => {
    const groups = new Map<string, FormBundle[]>();
    for (const item of data?.bundles ?? []) groups.set(item.family_id, [...(groups.get(item.family_id) ?? []), item]);
    const needle = query.toLowerCase();
    return [...groups.values()]
      .map((items) => [...items].sort((a, b) => b.version - a.version))
      .filter((items) => items.some((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(needle)
        && (lifecycle === "all" || lifecycle === "active" ? item.lifecycle !== "archived" : item.lifecycle === lifecycle)))
      .sort((a, b) => a[0]!.name.localeCompare(b[0]!.name));
  }, [data?.bundles, lifecycle, query]);
  const submissionGroups = useMemo(() => groupSubmissions(data?.submissions ?? [], data?.bundles ?? [], []), [data?.bundles, data?.submissions]);
  const canAuthor = hasPermission(access, "forms.manage");

  const act = async (form: FormBundle, action: () => Promise<unknown>, failure: string) => {
    setBusyId(form.id);
    setActionError(null);
    try { await action(); await refresh(); }
    catch (caught) { setActionError(caught instanceof Error ? caught.message : failure); }
    finally { setBusyId(null); }
  };

  if (loading) return <LoadingState label="Loading forms..." />;
  if (error && !data) return <ErrorState message={error} onRetry={() => void reload()} title="Unable to load Forms" />;

  return <Screen refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} tintColor={theme.colors.primary} />} scroll>
    <View style={styles.titleRow}><FileText color={theme.colors.primary} size={24} /><View style={styles.titleCopy}><Text variant="heading" weight="bold">Forms Library</Text><Text tone="muted" variant="small">Choose a form, fill it in, and submit. Workflow forms continue automatically in the background.</Text></View></View>
    {canAuthor ? <Button full label="New form" onPress={() => navigation.navigate("FormBuilder", undefined)} /> : null}
    <SegmentedControl accessibilityLabel="Forms view" onChange={setTab} options={[{ value: "templates", label: "Forms to fill" }, { value: "submissions", label: "My submissions" }]} value={tab} />
    {actionError ? <Banner tone="danger">{actionError === PINNED_BY_FMS ? "This version is in an active FMS stage. Use Publish as new to preserve in-progress work and publish your edited copy." : actionError}</Banner> : null}
    {tab === "templates" ? <>
      <SearchField accessibilityLabel="Search forms" onChangeText={setQuery} placeholder="Find a form to fill" value={query} />
      <OptionPicker label="Lifecycle filter" onChange={(selected) => setLifecycle(selected[0] ?? "active")} options={[{ value: "active", label: "Current and drafts" }, { value: "published", label: "Published" }, { value: "draft", label: "Drafts" }, { value: "archived", label: "Archived history" }, { value: "all", label: "All lifecycle" }]} selected={[lifecycle]} />
      {families.length === 0 ? <Card><Text style={styles.centered} tone="muted">No forms match these filters.</Text></Card> : families.map((versions) => (
        <Card key={versions[0]!.family_id}>
          <Text weight="semibold">{versions[0]!.name}</Text>
          {versions[0]!.description ? <Text tone="muted" variant="small">{versions[0]!.description}</Text> : null}
          {versions.map((form) => (
            <VersionRow
              busy={busyId === form.id}
              canAuthor={canAuthor}
              form={form}
              key={form.id}
              onArchive={() => void confirm("Archive form", "Archive this form version?", "Archive").then((ok) => { if (ok) void act(form, () => archiveForm(form.id), "Archive failed"); })}
              onDelete={() => setDeleting(form)}
              onDuplicate={() => void act(form, () => duplicateForm(form.id), "Duplicate failed")}
              onEdit={() => navigation.navigate("FormBuilder", { formTemplateId: form.id })}
              // A published version is edited in place, as on the web; the
              // builder saves it through save_published_form_with_audit.
              onEditPublished={() => navigation.navigate("FormBuilder", { formTemplateId: form.id })}
              onFill={() => navigation.navigate("FormFill", { formTemplateId: form.id })}
              onPublish={() => void act(form, () => publishForm(form.id), "Publish failed")}
              onPublishAsNew={() => void confirm("Publish as new", "Publish this edited version as a separate form? Active FMS stages will keep using the current version.", "Publish as new").then((ok) => { if (ok) void act(form, () => publishAsNewForm(form.id), "Publish as new form failed"); })}
            />
          ))}
        </Card>
      ))}
    </> : submissionGroups.length === 0 ? <Card><Text style={styles.centered} tone="muted">No submissions visible to your account.</Text></Card> : submissionGroups.map((group) => (
      <Card key={group.key}>
        <View style={styles.cardHeading}><Text style={styles.titleCopy} tone="primary" weight="semibold">{group.title}</Text><StatusBadge label={`${group.items.length} filled`} tone="primary" /></View>
        {group.items.map((item) => (
          <Pressable accessibilityRole="button" key={item.id} onPress={() => navigation.navigate("FormSubmission", { submissionId: item.id })} style={({ pressed }) => [styles.submissionRow, pressed && styles.pressed]}>
            <View style={styles.cardHeading}><Text variant="small" weight="medium">Submission details</Text><StatusBadge label={titleCase(item.status)} tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "warning"} /></View>
            <Text tone="muted" variant="caption">{`Filled ${formatDateTime(item.submittedAt, "")} · ${item.linkedModule ?? "Standalone form"}`}</Text>
          </Pressable>
        ))}
      </Card>
    ))}
    <FormLifecycleActions form={deleting} onClose={() => setDeleting(null)} onDeleted={async () => { await refresh(); }} />
  </Screen>;
}

function VersionRow({ form, canAuthor, busy, onFill, onEdit, onPublish, onPublishAsNew, onEditPublished, onArchive, onDelete, onDuplicate }: {
  form: FormBundle; canAuthor: boolean; busy: boolean; onFill: () => void; onEdit: () => void; onPublish: () => void; onPublishAsNew: () => void;
  onEditPublished: () => void; onArchive: () => void; onDelete: () => void; onDuplicate: () => void;
}) {
  const styles = useStyles();
  const roles = Array.isArray((form.permissions as { roles?: unknown })?.roles) ? ((form.permissions as { roles: string[] }).roles.join(", ") || "none") : "none";
  return (
    <View style={styles.versionRow}>
      <Text tone="warm" variant="small">{`v${form.version} | ${form.lifecycle}${form.lifecycle === "published" ? " | Current published" : ""} | ${form.fields.length} fields | ${form.submissionCount} submissions`}</Text>
      <Text tone="muted" variant="caption">{`Roles: ${roles}`}</Text>
      <View style={styles.actions}>
        {form.lifecycle === "published" ? <Button label="Fill" onPress={onFill} variant="secondary" /> : null}
        {canAuthor && form.lifecycle === "draft" ? <>
          <Button busy={busy} label="Edit" onPress={onEdit} variant="secondary" />
          <Button busy={busy} label="Publish" onPress={onPublish} />
          <Button busy={busy} label="Publish as new" onPress={onPublishAsNew} variant="secondary" />
        </> : null}
        {canAuthor && form.lifecycle === "published" ? <Button busy={busy} label="Edit" onPress={onEditPublished} variant="secondary" /> : null}
        {canAuthor ? <Button busy={busy} label="Duplicate" onPress={onDuplicate} variant="ghost" /> : null}
        {canAuthor ? <Button busy={busy} label="Delete" onPress={onDelete} variant="danger" /> : null}
        {canAuthor && form.lifecycle !== "archived" ? <Button busy={busy} label="Archive" onPress={onArchive} variant="danger" /> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  titleCopy: { flex: 1, minWidth: 0, gap: 2 },
  centered: { textAlign: "center" },
  cardHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm },
  versionRow: { gap: theme.space.xs, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.space.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  submissionRow: { gap: 2, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.space.sm },
  pressed: { opacity: 0.7 },
}));
