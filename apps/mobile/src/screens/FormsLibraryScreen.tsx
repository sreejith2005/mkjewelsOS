import { useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { FileText } from "lucide-react-native";
import { loadForms, type FormBundle } from "@jewelos/data/forms/api";
import { formatDateTime, titleCase } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import type { RootStackParamList } from "@/navigation/types";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Tab = "templates" | "submissions";

export function FormsLibraryScreen() {
  const navigation = useNavigation<Navigation>();
  const theme = useAppTheme();
  const styles = useStyles();
  const [tab, setTab] = useState<Tab>("templates");
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState("active");
  const { data, error, loading, refreshing, refresh, reload } = useAsyncData(loadForms, []);
  const bundles = useMemo(() => (data?.bundles ?? []).filter((item) => {
    const matchesQuery = `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase());
    const matchesLife = lifecycle === "all" || lifecycle === "active" ? item.lifecycle !== "archived" : item.lifecycle === lifecycle;
    return matchesQuery && matchesLife;
  }).sort((left, right) => left.name.localeCompare(right.name) || right.version - left.version), [data?.bundles, lifecycle, query]);
  const bundleById = useMemo(() => new Map((data?.bundles ?? []).map((bundle) => [bundle.id, bundle])), [data?.bundles]);

  if (loading) return <LoadingState label="Loading forms..." />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} title="Could not load forms" />;

  return <Screen refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} tintColor={theme.colors.primary} />} scroll>
    <View style={styles.titleRow}><FileText color={theme.colors.primary} size={24} /><View style={styles.titleCopy}><Text variant="heading" weight="bold">Forms Library</Text><Text tone="muted" variant="small">Choose a form, fill it in, and submit. Linked workflows continue automatically.</Text></View></View>
    <SegmentedControl accessibilityLabel="Forms view" onChange={setTab} options={[{ value: "templates", label: "Forms to fill" }, { value: "submissions", label: "My submissions" }]} value={tab} />
    {tab === "templates" ? <>
      <SearchField accessibilityLabel="Search forms" onChangeText={setQuery} placeholder="Find a form to fill" value={query} />
      <OptionPicker label="Lifecycle filter" onChange={(selected) => setLifecycle(selected[0] ?? "active")} options={[{ value: "active", label: "Current and drafts" }, { value: "published", label: "Published" }, { value: "draft", label: "Drafts" }, { value: "archived", label: "Archived history" }, { value: "all", label: "All lifecycle" }]} selected={[lifecycle]} />
      {bundles.length === 0 ? <Card><Text style={styles.centered} tone="muted">No forms match these filters.</Text></Card> : bundles.map((form) => <FormCard form={form} key={form.id} onFill={() => navigation.navigate("FormFill", { formTemplateId: form.id })} />)}
    </> : (data?.submissions ?? []).length === 0 ? <Card><Text style={styles.centered} tone="muted">No submissions visible to your account.</Text></Card> : (data?.submissions ?? []).map((submission) => {
      const form = submission.form_template_id ? bundleById.get(submission.form_template_id) : undefined;
      return <Card key={submission.id}><View style={styles.cardHeading}><View style={styles.titleCopy}><Text weight="semibold">{form?.name ?? "Historical form"}</Text><Text tone="muted" variant="caption">Filled {formatDateTime(submission.submitted_at, "")}</Text></View><StatusBadge label={titleCase(submission.status)} tone={submission.status === "approved" ? "success" : submission.status === "rejected" ? "danger" : "warning"} /></View><Text tone="muted" variant="caption">{submission.linked_module ? `Linked to ${titleCase(submission.linked_module)}` : "Standalone form"}</Text></Card>;
    })}
  </Screen>;
}

function FormCard({ form, onFill }: { form: FormBundle; onFill: () => void }) {
  const styles = useStyles();
  const roles = Array.isArray((form.permissions as { roles?: unknown })?.roles) ? ((form.permissions as { roles: string[] }).roles.join(", ") || "none") : "none";
  return <Card accent={form.lifecycle === "published" ? "primary" : "none"}><View style={styles.cardHeading}><View style={styles.titleCopy}><Text weight="semibold">{form.name}</Text>{form.description ? <Text tone="muted" variant="small">{form.description}</Text> : null}</View><StatusBadge label={`v${form.version} ${titleCase(form.lifecycle)}`} tone={form.lifecycle === "published" ? "success" : form.lifecycle === "draft" ? "warning" : "neutral"} /></View><View style={styles.badges}><StatusBadge label={`${form.fields.length} fields`} /><StatusBadge label={`${form.submissionCount} submissions`} /></View><Text tone="muted" variant="caption">Roles: {roles}</Text>{form.lifecycle === "published" ? <Button label="Fill form" onPress={onFill} variant="secondary" /> : null}</Card>;
}

const useStyles = makeStyles((theme) => StyleSheet.create({ titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm }, titleCopy: { flex: 1, minWidth: 0, gap: 2 }, centered: { textAlign: "center" }, cardHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm }, badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs } }));
