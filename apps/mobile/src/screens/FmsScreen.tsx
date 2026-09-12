import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { GitBranch } from "lucide-react-native";
import { hasPermission } from "@jewelos/core";
import {
  deleteFmsFlow,
  loadFmsBuilderData,
  loadFmsRuntime,
  restoreFmsFlow,
  reviseFmsFlow,
  setFmsFlowActive,
  startFmsInstance,
  type FmsFlowRow,
} from "@jewelos/data/fms/api";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import type { RootStackParamList } from "@/navigation/types";
import { FmsTasksScreen } from "@/screens/FmsTasksScreen";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type FlowState = "live" | "paused" | "draft" | "archived";
type FlowFamily = { key: string; primary: FmsFlowRow; versions: FmsFlowRow[]; flowIds: string[] };
type Filter = "all" | FlowState | "mine";

const OPEN_STAGE_STATUSES = ["pending", "in_progress", "in_review", "overdue"];
const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "mine", label: "Assigned to me" },
  { value: "live", label: "Live" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Drafts" },
  { value: "archived", label: "Archived" },
];
const STATE_TONE: Record<FlowState, "success" | "neutral" | "warning"> = {
  live: "success",
  paused: "neutral",
  draft: "warning",
  archived: "neutral",
};

const flowState = (flow: FmsFlowRow): FlowState =>
  flow.status === "draft" ? "draft" : flow.status === "archived" ? "archived" : flow.is_active ? "live" : "paused";

const loadConsole = async () => {
  const [builder, runtime] = await Promise.all([loadFmsBuilderData(), loadFmsRuntime().catch(() => undefined)]);
  return { builder, runtime };
};

const confirm = (title: string, message: string, action: string, destructive = false) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );

/**
 * The single FMS section, ported from the web `FMSBuilderPage`: every workflow
 * family on one list with all of its controls on the card. New workflow, Edit
 * draft, and New version open the native builder (`FmsBuilderScreen`).
 */
export function FmsScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const access = useAccess();
  const navigation = useNavigation<Navigation>();
  const canManage = hasPermission(access, "fms.manage");
  const state = useAsyncData(loadConsole, []);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tasksFor, setTasksFor] = useState<FlowFamily | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const data = state.data?.builder;
  // Coming back from the builder must show what was just saved or published.
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void state.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));
  const runtime = state.data?.runtime;

  const families = useMemo<FlowFamily[]>(() => {
    const grouped = new Map<string, FmsFlowRow[]>();
    for (const flow of data?.flows ?? []) grouped.set(flow.family_id, [...(grouped.get(flow.family_id) ?? []), flow]);
    return [...grouped.entries()].map(([key, rows]) => {
      const versions = [...rows].sort((left, right) => right.version - left.version);
      const primary = versions.find((flow) => flow.status === "published") ?? versions.find((flow) => flow.status === "draft") ?? versions[0]!;
      const runtimeIds = (runtime?.flows ?? []).filter((flow) => flow.family_id === key).map((flow) => flow.id);
      return { key, primary, versions, flowIds: [...new Set([...versions.map((flow) => flow.id), ...runtimeIds])] };
    }).sort((left, right) => left.primary.name.localeCompare(right.primary.name));
  }, [data, runtime]);

  const countsFor = useCallback((family: FlowFamily) => {
    const instances = (runtime?.instances ?? []).filter((instance) => family.flowIds.includes(instance.fms_flow_id));
    const stages = (runtime?.stages ?? []).filter((stage) => instances.some((instance) => instance.id === stage.fms_instance_id));
    return {
      running: instances.filter((instance) => ["active", "overdue", "on_hold"].includes(instance.status)).length,
      completed: instances.filter((instance) => instance.status === "completed").length,
      mine: new Set(stages.filter((stage) => OPEN_STAGE_STATUSES.includes(stage.status) && stage.assigned_to?.includes(profile.id)).map((stage) => stage.fms_instance_id)).size,
    };
  }, [profile.id, runtime]);

  const visible = useMemo(() => families.filter((family) => {
    if (!`${family.primary.name} ${family.primary.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "mine") return countsFor(family).mine > 0;
    return family.versions.some((flow) => flowState(flow) === filter);
  }), [countsFor, families, filter, query]);

  if (tasksFor) {
    return (
      <FmsTasksScreen
        flowIds={tasksFor.flowIds}
        heading={`${tasksFor.primary.name} — live instances`}
        onBack={() => setTasksFor(null)}
      />
    );
  }
  if (state.loading) return <Screen><LoadingState label="Loading FMS…" /></Screen>;
  if (state.error && !state.data) return <Screen><ErrorState message={state.error} onRetry={() => void state.reload()} /></Screen>;

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    setActionError(null);
    setNotice(null);
    try {
      await action();
      await state.refresh();
    } catch (caught) {
      setActionError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  const start = (flow: FmsFlowRow) => run(flow.id, async () => {
    const stage = (data?.stages ?? []).filter((item) => item.fms_flow_id === flow.id).sort((left, right) => left.sort_order - right.sort_order)[0];
    const firstAssigneeId = (data?.assignees ?? []).find((item) => item.fms_stage_id === stage?.id && item.assignee_type === "specific_user")?.user_profile_id ?? null;
    const result = await startFmsInstance({
      flowId: flow.id,
      title: flow.name,
      priority: "medium",
      context: {},
      branchId: flow.branch_id ?? profile.branch_id ?? "",
      departmentId: flow.department_id ?? profile.department_id ?? "",
      firstAssigneeId,
    });
    setNotice(`Started ${result.reference_number}`);
    navigation.navigate("FmsInstance", { instanceId: result.instance_id });
  });

  const remove = async (flow: FmsFlowRow) => {
    const permanent = flow.status === "draft";
    const ok = await confirm(
      permanent ? "Delete draft?" : "Archive workflow?",
      permanent ? `Delete the draft "${flow.name}" permanently?` : `"${flow.name}" v${flow.version} has already run, so it will be archived instead of erased. Continue?`,
      permanent ? "Delete" : "Archive",
      true,
    );
    if (ok) void run(flow.id, () => deleteFmsFlow(flow.id));
  };

  const toggleActive = async (flow: FmsFlowRow) => {
    if (flow.is_active && !(await confirm("Pause workflow?", `Pause "${flow.name}"? Running instances continue, but nobody can start it again until you resume.`, "Pause"))) return;
    void run(flow.id, () => setFmsFlowActive(flow.id, !flow.is_active));
  };

  const openBuilder = (flowId: string | null) => navigation.navigate("FmsBuilder", { flowId });
  const revise = (flow: FmsFlowRow) => run(flow.id, async () => {
    const draftId = await reviseFmsFlow(flow.id);
    if (draftId) openBuilder(String(draftId));
  });

  return (
    <Screen
      refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void state.refresh()} refreshing={state.refreshing} tintColor={theme.colors.primary} />}
      scroll
    >
      <View style={styles.hero}>
        <GitBranch color={theme.colors.brand} size={28} />
        <View style={styles.flex}>
          <Text variant="heading" weight="semibold">FMS</Text>
          <Text tone="muted" variant="small">Every workflow in one place — start it, run its tasks, edit, pause, or remove it.</Text>
        </View>
      </View>
      {canManage ? <Button full label="New workflow" onPress={() => openBuilder(null)} /> : null}
      <SearchField accessibilityLabel="Search workflows" onChangeText={setQuery} placeholder="Search workflows..." value={query} />
      <SegmentedControl accessibilityLabel="Workflow filter" onChange={setFilter} options={FILTERS} value={filter} />
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {notice ? <Banner tone="success">{notice}</Banner> : null}
      {visible.length === 0 ? (
        <EmptyState message={`No workflows match this view.${canManage ? " Create one with New workflow." : ""}`} title="No workflows" />
      ) : visible.map((family) => {
        const flow = family.primary;
        const flowStatus = flowState(flow);
        const counts = countsFor(family);
        const draft = family.versions.find((item) => item.status === "draft");
        const busy = family.versions.some((item) => item.id === busyId);
        const older = family.versions.filter((item) => item.id !== flow.id && item.id !== draft?.id);
        return (
          <Card accent={flowStatus === "live" ? "success" : "none"} key={family.key}>
            <View style={styles.titleRow}>
              <Text style={styles.flex} variant="subtitle" weight="semibold">{flow.name}</Text>
              <StatusBadge label={flowStatus.toUpperCase()} tone={STATE_TONE[flowStatus]} />
            </View>
            {draft && draft.id !== flow.id ? <StatusBadge label={`draft v${draft.version} in progress`} tone="warning" /> : null}
            <Text tone="muted" variant="small">{flow.description || "No description added."}</Text>
            <Text tone="muted" variant="caption">
              {`v${flow.version} · used ${flow.usage_count} times · ${counts.running} running · ${counts.completed} completed${counts.mine ? ` · ${counts.mine} assigned to you` : ""}`}
            </Text>
            <View style={styles.actions}>
              {flowStatus === "live" ? <Button busy={busy} label="Start instance" onPress={() => void start(flow)} /> : null}
              <Button label={`Tasks${counts.mine ? ` (${counts.mine})` : ""}`} onPress={() => setTasksFor(family)} variant="secondary" />
              {canManage && draft ? <Button disabled={busy} label="Edit draft" onPress={() => openBuilder(draft.id)} variant="secondary" /> : null}
              {canManage && !draft && flow.status !== "draft" ? <Button disabled={busy} label="New version" onPress={() => void revise(flow)} variant="secondary" /> : null}
              {canManage && flow.status === "published" ? <Button disabled={busy} label={flow.is_active ? "Pause" : "Resume"} onPress={() => void toggleActive(flow)} variant="secondary" /> : null}
              {canManage && flowStatus === "archived" ? <Button disabled={busy} label="Restore" onPress={() => void run(flow.id, () => restoreFmsFlow(flow.id))} variant="secondary" /> : null}
              {canManage ? <Button accessibilityHint={`Delete ${flow.name}`} disabled={busy} label="Delete" onPress={() => void remove(flow)} variant="danger" /> : null}
            </View>
            {canManage && older.length ? (
              <View style={styles.history}>
                <Text tone="muted" variant="caption" weight="semibold">Version history ({older.length})</Text>
                {older.map((version) => (
                  <View key={version.id} style={styles.historyRow}>
                    <Text style={styles.flex} tone="muted" variant="caption">{`v${version.version} · ${flowState(version)} · used ${version.usage_count} times`}</Text>
                    {version.status === "archived" ? <Button disabled={busyId === version.id} label="Restore" onPress={() => void run(version.id, () => restoreFmsFlow(version.id))} variant="ghost" /> : null}
                    <Button disabled={busyId === version.id} label="Delete" onPress={() => void remove(version)} variant="ghost" />
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.brandSoft,
    borderRadius: theme.radius.xl,
    padding: theme.space.md,
  },
  flex: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  history: { gap: theme.space.xs, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: theme.space.sm },
  historyRow: { flexDirection: "row", alignItems: "center", gap: theme.space.xs },
}));
