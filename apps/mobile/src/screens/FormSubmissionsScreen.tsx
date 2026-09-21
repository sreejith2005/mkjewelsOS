import { useCallback } from "react";
import { RefreshControl } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { loadFormDynamicOptions, loadForms } from "@jewelos/data/forms/api";
import { groupSubmissions } from "@/features/forms/submissionModel";
import { formatDateTime, titleCase } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Card, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
export function FormSubmissionsScreen() {
  const navigation = useNavigation<Navigation>(); const theme = useAppTheme();
  const load = useCallback(async () => { const [forms, options] = await Promise.all([loadForms(), loadFormDynamicOptions()]); return { ...forms, groups: groupSubmissions(forms.submissions, forms.bundles, options.masters) }; }, []);
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  if (loading && !data) return <Screen><LoadingState label="Loading submissions…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  return <Screen refreshControl={<RefreshControl colors={[theme.colors.primary]} refreshing={refreshing} onRefresh={() => void refresh()} />} scroll>{data?.groups.length ? data.groups.map((group) => <Card key={group.key}><Text weight="semibold">{group.title}</Text><StatusBadge label={`${group.items.length} filled`} />{group.items.map((item) => <Card key={item.id} onPress={() => navigation.navigate("FormSubmission", { submissionId: item.id })}><Text weight="medium">Submission details</Text><Text tone="muted" variant="caption">Filled {formatDateTime(item.submittedAt, "")} · {item.linkedModule ? titleCase(item.linkedModule) : "Standalone form"}</Text><StatusBadge label={titleCase(item.status)} tone={item.status === "approved" ? "success" : item.status === "rejected" ? "danger" : "warning"} /></Card>)}</Card>) : <EmptyState title="No submissions" message="No submissions are visible to your account." />}</Screen>;
}
