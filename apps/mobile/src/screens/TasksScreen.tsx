import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Plus } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  countTaskFeedStatuses,
  deriveTaskMutationCapability,
  taskEvidenceFileError,
  taskMatchesStatus,
  type TaskFeedStatusFilter,
} from "@jewelos/core";
import { reviseTask, updateTask, uploadAndCompleteTask, type TaskBundle } from "@jewelos/data/tasks/api";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { useProfile } from "@/auth/AuthProvider";
import { TaskCard as ParityTaskCard, type TaskCardAction } from "@/features/tasks/TaskCard";
import { canManageTaskWorkspace, hasAdminTaskView, loadTaskWorkspace } from "@/features/tasks/taskWorkspace";
import { useAsyncData } from "@/lib/useAsyncData";
import { pickFileFromChooser } from "@/lib/pickFile";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";
import { TASKS_PRIMARY_ACTION } from "@/navigation/shellModel";
import { fmsAssignedWorkRouteForTask, navigateFmsAssignedWork } from "@/features/fms/assignedWorkNavigation";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Workspace = "mine" | "delegated";

/**
 * My Tasks and Delegated Tasks, as one scannable list rather than the web's
 * table. The feeds come from `loadTaskWorkspace`, which Task detail also reads,
 * and the split between them is `splitAssignedTaskFeed` from the shared core,
 * so the two clients never disagree about which work lands where.
 */
export function TasksScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const [workspace, setWorkspace] = useState<Workspace>("mine");
  const [status, setStatus] = useState<TaskFeedStatusFilter>("pending");

  // The web Tasks page offers Bulk Import to managers and Assigning Left to
  // administrators only; the server re-checks both.
  const canManage = canManageTaskWorkspace(profile);
  const hasAdminView = hasAdminTaskView(profile);

  const load = useCallback(() => loadTaskWorkspace(profile, { prepareRecurring: true }), [profile]);

  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void refresh();
  }, [refresh]));
  useEffect(() => subscribeToTenantRealtime(profile.tenant_id, ["tasks", "forms", "organization"], () => void refresh()), [profile.tenant_id, refresh]);

  const tasks = useMemo(() => {
    const source = data ? data[workspace] : [];
    return source.filter((task) => taskMatchesStatus(task, status));
  }, [data, status, workspace]);

  const counts = useMemo(() => countTaskFeedStatuses(data ? data[workspace] : []), [data, workspace]);
  const openCounts = useMemo(() => ({
    mine: countTaskFeedStatuses(data?.mine ?? []).open,
    delegated: countTaskFeedStatuses(data?.delegated ?? []).open,
  }), [data]);
  const categoryNames = useMemo(() => new Map((data?.categories ?? []).map((item) => [item.id, item.label])), [data?.categories]);

  const handleAction = async (task: TaskBundle, action: TaskCardAction) => {
    if (!task.id) throw new Error("Task identifier is missing");
    const capability = deriveTaskMutationCapability({
      assigneeIds: task.assignees.map((assignee) => assignee.id),
      isWatcher: task.isWatchedByViewer,
      viewerId: profile.id,
      viewerRole: profile.user_role,
    });
    if (!capability.canMutate) throw new Error("You do not have permission to update this task");
    if (action.kind === "fill_form") {
      // FMS work is completed through its workflow surface, never the ordinary
      // task form route, so resolve the FMS identity first.
      const fms = fmsAssignedWorkRouteForTask(task);
      if (fms) {
        navigateFmsAssignedWork(navigation, fms);
        return;
      }
      if (!task.form_template_id) throw new Error("The required form is missing");
      navigation.navigate("TaskForm", {
        taskId: task.id,
        formTemplateId: task.form_template_id,
        taskType: task.task_type,
      });
      return;
    }
    if (action.kind === "upload_and_complete") {
      const picked = await pickFileFromChooser("Upload evidence");
      if (!picked.ok) { if (picked.cancelled) return; throw new Error(picked.message); }
      const invalid = taskEvidenceFileError(picked.file);
      if (invalid) throw new Error(invalid);
      await uploadAndCompleteTask(profile.tenant_id, task.id, picked.file);
    } else if (action.kind === "revise") await reviseTask(task.id, action.datetime, action.reason);
    else if (action.kind === "checklist") await updateTask(task.id, "checklist", { checklistId: action.checklistId, completed: action.completed });
    else await updateTask(task.id, "complete", { remark: action.remark });
    await refresh();
  };

  if (loading) return <Screen><LoadingState label="Loading your tasks…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;

  return (
    <Screen padded={false}>
      <View style={styles.controls}>
        <SegmentedControl
          accessibilityLabel="Task workspace"
          onChange={setWorkspace}
          options={[
            { value: "mine", label: `My Tasks (${openCounts.mine})` },
            { value: "delegated", label: `Delegated (${openCounts.delegated})` },
          ]}
          value={workspace}
        />
        <SegmentedControl
          accessibilityLabel="Task filters"
          onChange={setStatus}
          options={[
            { value: "pending", label: `Pending (${counts.pending})` },
            { value: "overdue", label: `Overdue (${counts.overdue})` },
            { value: "completed", label: `Completed (${counts.completed})` },
          ]}
          value={status}
        />
        {canManage ? (
          <View style={styles.adminActions}>
            {/* The follow-up to a bulk import: rows that arrived without a
                usable employee name. Administrators only, as on the web. */}
            {hasAdminView ? (
              <Button label="Assigning Left" onPress={() => navigation.navigate("AssigningLeft")} variant="secondary" />
            ) : null}
            <Button label="Bulk Import" onPress={() => navigation.navigate("TaskImport")} variant="secondary" />
          </View>
        ) : null}
        {error ? <Text tone="danger" variant="caption">{`Could not refresh: ${error}`}</Text> : null}
      </View>

      <FlatList
        contentContainerStyle={[tasks.length === 0 ? styles.emptyContent : styles.listContent, { paddingBottom: 88 + insets.bottom }]}
        data={tasks}
        // Tasks are keyed by their instance id; the feed view can repeat a row
        // per assignee, and the id is what makes a card one task.
        keyExtractor={(task) => task.id ?? String(task.task_template_id)}
        ListEmptyComponent={<EmptyState message="It seems that you don’t have any tasks in this list." title="No Tasks Here" />}
        refreshControl={
          <RefreshControl
            colors={[theme.colors.primary]}
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            tintColor={theme.colors.primary}
          />
        }
        renderItem={({ item }) => (
          <ParityTaskCard
            capability={deriveTaskMutationCapability({ assigneeIds: item.assignees.map((assignee) => assignee.id), isWatcher: item.isWatchedByViewer, viewerId: profile.id, viewerRole: profile.user_role })}
            categoryLabel={item.category_id ? categoryNames.get(item.category_id) ?? "Uncategorized" : "Uncategorized"}
            onAction={(action) => handleAction(item, action)}
            onOpenDetails={() => item.id && navigation.navigate("TaskDetail", { taskId: item.id })}
            task={item}
          />
        )}
        // A staff member can carry hundreds of occurrences; windowing keeps
        // scrolling smooth instead of mounting every card at once.
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
      />
      <View pointerEvents="box-none" style={[styles.createAction, { bottom: theme.space.md + insets.bottom }]}>
        <Button accessibilityHint="Opens the task creation form" icon={<Plus color={theme.colors.background} size={20} />} label={TASKS_PRIMARY_ACTION.label} onPress={() => navigation.navigate(TASKS_PRIMARY_ACTION.route)} />
      </View>
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  controls: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
    paddingBottom: theme.space.sm,
  },
  adminActions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  listContent: { padding: theme.space.md, paddingTop: 0, gap: theme.space.sm },
  emptyContent: { flexGrow: 1 },
  createAction: { position: "absolute", right: theme.space.md },
}));
