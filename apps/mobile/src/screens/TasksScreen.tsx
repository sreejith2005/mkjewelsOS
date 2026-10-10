import { useTenantRealtimeRefresh } from "@/lib/useTenantRealtimeRefresh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Plus } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  TASK_PAGE_SIZE,
  hasPermission,
  type TaskWorkspaceView,
  deriveTaskMutationCapability,
  taskEvidenceFileError,
  type TaskFeedStatusFilter,
  TASK_IN_LOOP_PATH,
} from "@jewelos/core";
import { ensureMyRecurringTasks, reviseTask, updateTask, uploadAndCompleteTask, type TaskBundle } from "@jewelos/data/tasks/api";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { TaskCard as ParityTaskCard, type TaskCardAction } from "@/features/tasks/TaskCard";
import { loadTaskWorkspacePage } from "@/features/tasks/taskWorkspace";
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
type Workspace = TaskWorkspaceView;

/** Loads only the selected server page; details use their persisted task identity. */
export function TasksScreen({ path = "/tasks" }: Readonly<{ path?: string }>) {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const navigation = useNavigation<Navigation>();
  const insets = useSafeAreaInsets();
  const [workspace, setWorkspace] = useState<Workspace>(path === TASK_IN_LOOP_PATH ? "inLoop" : "mine");
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<TaskFeedStatusFilter>("pending");
  useEffect(() => { if (path === TASK_IN_LOOP_PATH) setWorkspace("inLoop"); }, [path]);

  // The web Tasks page offers Bulk Import to managers and Assigning Left to
  // administrators only; the server re-checks both.
  const access = useAccess();
  const canManage = hasPermission(access, "tasks.manage_team");
  const hasAdminView = hasPermission(access, "tasks.view_all");

  const identity = `${profile.id}|${workspace}|${status}|${offset}`;
  const load = useCallback(() => loadTaskWorkspacePage(profile, workspace, status, offset), [profile, workspace, status, offset]);

  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  useEffect(() => {
    if (data?.identity === identity && offset > 0 && offset >= data.total) setOffset(Math.max(0, Math.floor((data.total - 1) / TASK_PAGE_SIZE) * TASK_PAGE_SIZE));
  }, [data, identity, offset]);
  useTenantRealtimeRefresh({ tenantId: profile.tenant_id, topics: ["tasks", "forms", "fms", "organization"], refresh: refresh });

  useEffect(() => {
    let active = true;
    void ensureMyRecurringTasks().then((result) => { if (active && result.created) void refresh(); }).catch(() => undefined);
    return () => { active = false; };
  }, [profile.id, refresh]);
  const current = data?.identity === identity;
  const tasks = current ? data.tasks : [];
  const counts = current ? data.counts : { pending: 0, overdue: 0, completed: 0, open: 0 };
  const changeWorkspace = (value: Workspace) => { setWorkspace(value); setOffset(0); };
  const changeStatus = (value: TaskFeedStatusFilter) => { setStatus(value); setOffset(0); };
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

  if (loading || (!current && !error)) return <Screen><LoadingState label="Loading your tasks…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;

  return (
    <Screen padded={false}>
      <View style={styles.controls}>
        <SegmentedControl
          accessibilityLabel="Task workspace"
          onChange={changeWorkspace}
          options={[
            { value: "mine", label: "My Tasks" },
            { value: "delegated", label: "Delegated" },
            { value: "inLoop", label: "In Loop" },
            ...(hasAdminView ? [{ value: "all" as const, label: "All Tasks" }] : []),
          ]}
          value={workspace}
        />
        <SegmentedControl
          accessibilityLabel="Task filters"
          onChange={changeStatus}
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
        ListFooterComponent={current ? <View style={styles.adminActions}>
          <Button label="Previous" disabled={refreshing || offset === 0} variant="secondary" onPress={() => setOffset(Math.max(0, offset - TASK_PAGE_SIZE))} />
          <Text variant="caption">{data.total === 0 ? "0 tasks" : `${offset + 1} - ${Math.min(offset + TASK_PAGE_SIZE, data.total)} of ${data.total}`}</Text>
          <Button label="Next" disabled={refreshing || offset + TASK_PAGE_SIZE >= data.total} variant="secondary" onPress={() => setOffset(offset + TASK_PAGE_SIZE)} />
        </View> : null}
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
