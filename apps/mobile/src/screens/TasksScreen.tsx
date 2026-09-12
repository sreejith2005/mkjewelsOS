import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  deriveTaskMutationCapability,
  kolkataDateKey,
  splitAssignedTaskFeed,
  taskMatchesStatus,
  type TaskFeedStatusFilter,
} from "@jewelos/core";
import { ensureMyRecurringTasks, loadTaskFeed, loadTaskFeedReferenceData, reviseTask, updateTask, uploadAndCompleteTask, type TaskBundle } from "@jewelos/data/tasks/api";
import { useProfile } from "@/auth/AuthProvider";
import { TaskCard as ParityTaskCard, type TaskCardAction } from "@/features/tasks/TaskCard";
import { useAsyncData } from "@/lib/useAsyncData";
import { log } from "@/lib/log";
import { pickFileFromChooser } from "@/lib/pickFile";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";
import { fmsAssignedWorkRouteForTask, navigateFmsAssignedWork } from "@/features/fms/assignedWorkNavigation";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Workspace = "mine" | "delegated";

const MANAGER_ROLES = new Set(["super_admin", "admin", "manager"]);

/**
 * My Tasks and Delegated Tasks, as one scannable list rather than the web's
 * table. The split between them is `splitAssignedTaskFeed` from the shared
 * core, so the two clients never disagree about which work lands where.
 */
export function TasksScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const navigation = useNavigation<Navigation>();
  const [workspace, setWorkspace] = useState<Workspace>("mine");
  const [status, setStatus] = useState<TaskFeedStatusFilter>("pending");

  const canManage = MANAGER_ROLES.has(profile.user_role);
  const hasAdminView = profile.user_role === "super_admin" || profile.user_role === "admin";

  const load = useCallback(async () => {
    const today = kolkataDateKey(new Date());
    const start = `${today}T00:00:00.000+05:30`;
    const end = `${today}T23:59:59.999+05:30`;
    // Recurring occurrences are generated on demand. If that call fails the
    // feed is still worth showing, so it never blocks the list.
    await ensureMyRecurringTasks().catch((error: unknown) => {
      log.warn("api", "could not prepare recurring tasks; showing the feed as it stands");
      log.debug("api", "recurring preparation error", error);
    });
    const [assigned, authored, references] = await Promise.all([
      loadTaskFeed(profile.id, start, end, { includeBlockedCoverage: canManage, includeOverdue: true }),
      hasAdminView
        ? loadTaskFeed(profile.id, start, end, { delegated: true, includeOverdue: true })
        : Promise.resolve<TaskBundle[]>([]),
      loadTaskFeedReferenceData().catch(() => ({ categories: [] })),
    ]);
    const split = splitAssignedTaskFeed(assigned);
    return {
      mine: hasAdminView ? assigned : split.myTasks,
      delegated: hasAdminView ? authored : split.delegatedTasks,
      categories: references.categories,
    };
  }, [canManage, hasAdminView, profile.id]);

  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);

  const tasks = useMemo(() => {
    const source = data ? data[workspace] : [];
    return source.filter((task) => taskMatchesStatus(task, status));
  }, [data, status, workspace]);

  const counts = useMemo(() => {
    const source = data ? data[workspace] : [];
    return {
      pending: source.filter((task) => taskMatchesStatus(task, "pending")).length,
      overdue: source.filter((task) => taskMatchesStatus(task, "overdue")).length,
      completed: source.filter((task) => taskMatchesStatus(task, "completed")).length,
    };
  }, [data, workspace]);
  const categoryNames = useMemo(() => new Map((data?.categories ?? []).map((item) => [item.id, item.label])), [data?.categories]);

  const handleAction = async (task: TaskBundle, action: TaskCardAction) => {
    if (!task.id) throw new Error("Task identifier is missing");
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
      const picked = await pickFileFromChooser("Upload evidence", { imagesOnly: true });
      if (!picked.ok) { if (picked.cancelled) return; throw new Error(picked.message); }
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
            { value: "mine", label: "My Tasks" },
            { value: "delegated", label: "Delegated" },
          ]}
          value={workspace}
        />
        <SegmentedControl
          accessibilityLabel="Task status"
          onChange={setStatus}
          options={[
            { value: "pending", label: `Pending ${counts.pending}` },
            { value: "overdue", label: `Overdue ${counts.overdue}` },
            { value: "completed", label: `Done ${counts.completed}` },
          ]}
          value={status}
        />
        {/* The follow-up to a desktop bulk import: rows that arrived without a
            usable employee name. Administrators only, as on the web. */}
        {profile.user_role === "super_admin" || profile.user_role === "admin" ? (
          <Button
            label="Assigning Left"
            onPress={() => navigation.navigate("AssigningLeft")}
            variant="secondary"
          />
        ) : null}
      </View>

      <FlatList
        contentContainerStyle={tasks.length === 0 ? styles.emptyContent : styles.listContent}
        data={tasks}
        // Tasks are keyed by their instance id; the feed view can repeat a row
        // per assignee, and the id is what makes a card one task.
        keyExtractor={(task) => task.id ?? String(task.task_template_id)}
        ListEmptyComponent={
          <EmptyState
            message={
              status === "completed"
                ? "Nothing has been completed here yet today."
                : status === "overdue"
                  ? "Nothing is overdue. "
                  : "You are all caught up."
            }
            title={`No ${status} tasks`}
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
  listContent: { padding: theme.space.md, paddingTop: 0, gap: theme.space.sm },
  emptyContent: { flexGrow: 1 },
}));
