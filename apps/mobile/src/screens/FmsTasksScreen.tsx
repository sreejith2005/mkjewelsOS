import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { calculateFmsProgress } from "@jewelos/core";
import { loadFmsRuntime, type FmsInstance } from "@jewelos/data/fms/api";
import { filterFmsInstances } from "@jewelos/data/fms/runtimeView";
import { useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { ToggleField } from "@/forms/ToggleField";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Tab = "mine" | "started" | "branch";

/** The web `FMSTasksPage` still grants the Branch view by role. */
const MANAGER_ROLES = new Set(["super_admin", "admin", "manager"]);
const LIVE_STAGE_STATUSES = new Set(["pending", "in_progress", "in_review", "overdue"]);

export type FmsTasksScreenProps = Readonly<{
  /** Scope the list to one workflow family, as the web card's Tasks button does. */
  flowIds?: readonly string[];
  heading?: string;
  onBack?: () => void;
}>;

/**
 * Live workflow instances — the web `FMSTasksPage`. Reached from a workflow
 * card in the FMS console; each card opens the instance where the stage work
 * happens.
 */
export function FmsTasksScreen({ flowIds, heading, onBack }: FmsTasksScreenProps) {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const navigation = useNavigation<Navigation>();
  const [tab, setTab] = useState<Tab>("mine");
  const [query, setQuery] = useState("");
  // The web list opens on active work, not on every instance ever run.
  const [status, setStatus] = useState("active");
  const [priority, setPriority] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const canManage = MANAGER_ROLES.has(profile.user_role);
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(loadFmsRuntime, []);

  const scopedInstances = useMemo(
    () => (data?.instances ?? []).filter((instance) => !flowIds || flowIds.includes(instance.fms_flow_id)),
    [data, flowIds],
  );
  const instances = useMemo(
    () =>
      filterFmsInstances({
        instances: scopedInstances,
        stages: data?.stages ?? [],
        profileId: profile.id,
        tab,
        query,
        status,
        priority,
        overdueOnly,
      }),
    [data, overdueOnly, priority, profile.id, query, scopedInstances, status, tab],
  );
  const tiles = useMemo(
    () => (["active", "overdue", "completed"] as const).map((item) => ({ item, count: instances.filter((instance) => instance.status === item).length })),
    [instances],
  );

  const describe = useCallback(
    (instance: FmsInstance) => {
      const stages = (data?.stages ?? []).filter((stage) => stage.fms_instance_id === instance.id);
      const progress = calculateFmsProgress(
        stages.map((stage) => ({
          required: data?.definitions.find((item) => item.id === stage.fms_stage_id)?.is_required ?? true,
          status: stage.status as never,
        })),
      );
      const current = stages
        .filter((stage) => LIVE_STAGE_STATUSES.has(stage.status))
        .map((stage) => data?.definitions.find((item) => item.id === stage.fms_stage_id)?.name)
        .filter((name): name is string => Boolean(name));
      return { progress, current };
    },
    [data],
  );

  if (loading) return <Screen><LoadingState label="Loading workflows…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;

  const header = (
    <View style={styles.controls}>
      {onBack ? <Button label="Back to FMS" onPress={onBack} variant="ghost" /> : null}
      <Text variant="title" weight="semibold">{heading ?? "Live instances"}</Text>
      <Text tone="muted" variant="caption">Processes assigned to you, started by you, or visible to your branch.</Text>
      <SegmentedControl
        accessibilityLabel="Workflow view"
        onChange={setTab}
        options={[
          { value: "mine", label: "My Stages" },
          { value: "started", label: "Started by Me" },
          ...(canManage ? ([{ value: "branch", label: "Branch View" }] as const) : []),
        ]}
        value={tab}
      />
      <SearchField
        accessibilityLabel="Search FMS instances"
        onChangeText={setQuery}
        placeholder="Search reference or title"
        value={query}
      />
      <SegmentedControl
        accessibilityLabel="Status filter"
        onChange={setStatus}
        options={[
          { value: "all", label: "All statuses" },
          { value: "active", label: "Active" },
          { value: "overdue", label: "Overdue" },
          { value: "on_hold", label: "On hold" },
          { value: "completed", label: "Completed" },
          { value: "cancelled", label: "Cancelled" },
        ]}
        value={status}
      />
      <SegmentedControl
        accessibilityLabel="Priority filter"
        onChange={setPriority}
        options={[
          { value: "all", label: "All priorities" },
          { value: "high", label: "High" },
          { value: "medium", label: "Medium" },
          { value: "low", label: "Low" },
        ]}
        value={priority}
      />
      <ToggleField disabled={false} label="Overdue only" onChange={setOverdueOnly} required={false} value={overdueOnly} />
      <View style={styles.tiles}>
        {tiles.map(({ item, count }) => (
          <View key={item} style={styles.tile}>
            <Text variant="title" weight="semibold">{String(count)}</Text>
            <Text tone="muted" variant="caption">{item[0]!.toUpperCase() + item.slice(1)}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <Screen padded={false}>
      <FlatList
        ListHeaderComponent={header}
        contentContainerStyle={instances.length === 0 ? styles.emptyContent : styles.listContent}
        data={instances}
        keyExtractor={(instance) => instance.id}
        ListEmptyComponent={
          <EmptyState
            message="No FMS instances match this view."
            title="No FMS tasks"
          />
        }
        refreshControl={
          <RefreshControl
            colors={[theme.colors.primary]}
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            tintColor={theme.colors.primary}
          />
        }
        renderItem={({ item }) => {
          const { progress, current } = describe(item);
          const overdue = item.status === "overdue";
          return (
            <Card
              accent={overdue ? "danger" : item.status === "completed" ? "success" : "none"}
              accessibilityHint="Opens the workflow and its steps"
              onPress={() => navigation.navigate("FmsInstance", { instanceId: item.id })}
            >
              <Text tone="primary" variant="caption">{item.reference_number}</Text>
              <Text numberOfLines={2} variant="body" weight="semibold">{item.title}</Text>
              <Text tone="muted" variant="caption">Current: {current.join(", ") || "Closed"}</Text>
              <View
                accessibilityLabel={`${progress.percent} percent complete`}
                accessibilityRole="progressbar"
                style={styles.track}
              >
                <View style={[styles.fill, { width: `${progress.percent}%` }]} />
              </View>
              <View style={styles.badges}>
                <StatusBadge
                  label={item.status.replaceAll("_", " ")}
                  tone={overdue ? "danger" : item.status === "completed" ? "success" : "neutral"}
                />
                <StatusBadge label={`${progress.completed}/${progress.total} steps`} />
                {item.priority ? <StatusBadge label={`${item.priority} priority`} tone={item.priority === "high" ? "warning" : "neutral"} /> : null}
              </View>
            </Card>
          );
        }}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
      />
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  // The controls scroll with the list, inside its horizontal padding.
  controls: {
    gap: theme.space.sm,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
  },
  listContent: { padding: theme.space.md, paddingTop: 0, gap: theme.space.sm },
  emptyContent: { flexGrow: 1, paddingHorizontal: theme.space.md },
  track: { height: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: theme.colors.primary },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  tiles: { flexDirection: "row", gap: theme.space.sm },
  tile: {
    flex: 1,
    alignItems: "center",
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingVertical: theme.space.sm,
  },
}));
