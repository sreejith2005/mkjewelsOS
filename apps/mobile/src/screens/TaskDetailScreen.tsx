import { useCallback, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  deriveTaskCardState,
  deriveTaskMutationCapability,
  effectiveTaskDeadline,
  isTaskFeedItemOverdue,
  kolkataDateKey,
  type Tables,
} from "@jewelos/core";
import {
  loadFmsTaskDeepLink,
  loadFmsTaskStageLink,
  loadTaskFeed,
  updateTask,
  uploadAndCompleteTask,
  uploadTaskAttachment,
  type TaskBundle,
} from "@jewelos/data/tasks/api";
import { useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDateTime, formatRelativeDeadline } from "@/lib/format";
import { errorText, log } from "@/lib/log";
import { chooseSource, pickFile, type PickSource } from "@/lib/pickFile";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { ToggleField } from "@/forms/ToggleField";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";
import { fmsAssignedWorkRouteForTask, navigateFmsAssignedWork } from "@/features/fms/assignedWorkNavigation";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "TaskDetail">;

/**
 * One task, and every action it allows.
 *
 * Which actions are offered follows the task's own record — a required form, a
 * checklist, an evidence upload — and the server re-checks all of it. Nothing
 * here decides whether a person may complete a task; hiding a button is a
 * courtesy, and `update_task_with_audit` is the actual gate.
 */
export function TaskDetailScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const today = kolkataDateKey(new Date());
    return loadTaskFeed(profile.id, `${today}T00:00:00.000+05:30`, `${today}T23:59:59.999+05:30`, {
      includeOverdue: true,
    });
  }, [profile.id]);

  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  const task = useMemo(() => data?.find((item) => item.id === params.taskId) ?? null, [data, params.taskId]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      log.error("api", "task action failed", caught);
      setActionError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Screen><LoadingState label="Loading the task…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!task) {
    return (
      <Screen>
        <EmptyState
          message="It may have been completed, reassigned, or moved outside today's window."
          title="Task not available"
        />
      </Screen>
    );
  }

  const deadline = effectiveTaskDeadline(task);
  const overdue = isTaskFeedItemOverdue(task);
  const done = task.status === "completed";
  const needsForm = task.requires_form === true && !task.hasFormSubmission;
  const checklists: Tables<"task_checklists">[] = task.checklists ?? [];
  const remaining = checklists.filter((item) => !item.is_completed).length;
  const capability = deriveTaskMutationCapability({
    assigneeIds: task.assignees.map((assignee) => assignee.id),
    isWatcher: task.isWatchedByViewer,
    viewerId: profile.id,
    viewerRole: profile.user_role,
  });
  const cardState = deriveTaskCardState({ task, hasAttachment: task.hasAttachment, hasFormSubmission: task.hasFormSubmission, checklists, capability });

  const completeWithImage = async (source: PickSource) => {
    const picked = await pickFile(source, { imagesOnly: true });
    if (!picked.ok) {
      if (!picked.cancelled) setActionError(picked.message);
      return;
    }
    await run(() => uploadAndCompleteTask(profile.tenant_id, task.id ?? "", picked.file));
  };

  const attach = async (source: PickSource) => {
    const picked = await pickFile(source);
    if (!picked.ok) {
      if (!picked.cancelled) setActionError(picked.message);
      return;
    }
    await run(() => uploadTaskAttachment(profile.tenant_id, task.id ?? "", picked.file));
  };

  const openFmsStage = async () => {
    await run(async () => {
      // Migration 0160 puts the work identity on the feed row itself, so the
      // common case needs no extra round trip. The lookups below remain only
      // for rows served by an older view.
      const direct = fmsAssignedWorkRouteForTask(task);
      if (direct) {
        navigateFmsAssignedWork(navigation, direct);
        return;
      }
      if (task.form_template_id) {
        const target = await loadFmsTaskDeepLink(task.id ?? "", task.form_template_id);
        navigation.navigate("FmsStageForm", target);
      } else {
        const target = await loadFmsTaskStageLink(task.id ?? "");
        navigation.navigate("FmsStage", target);
      }
    });
  };

  return (
    <Screen
      refreshControl={
        <RefreshControl
          colors={[theme.colors.primary]}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          tintColor={theme.colors.primary}
        />
      }
      scroll
    >
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      <View style={styles.header}>
        <Text variant="title" weight="semibold">
          {task.title ?? "Untitled task"}
        </Text>
        <View style={styles.badges}>
          <StatusBadge
            label={done ? "Completed" : overdue ? "Overdue" : "Pending"}
            tone={done ? "success" : overdue ? "danger" : "neutral"}
          />
          {task.priority ? <StatusBadge label={`${task.priority} priority`} /> : null}
        </View>
      </View>

      <Card>
        <CardRow label="Deadline" value={formatDateTime(deadline, "No deadline")} />
        {deadline && !done ? (
          <CardRow label="Time left" value={formatRelativeDeadline(deadline) ?? "—"} />
        ) : null}
        <CardRow label="Assigned to" value={task.assigneeName || "Unassigned"} />
        {task.verifierName ? <CardRow label="Verifier" value={task.verifierName} /> : null}
      </Card>

      {task.description ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            Details
          </Text>
          <Text tone="muted" variant="body">
            {task.description}
          </Text>
        </Card>
      ) : null}

      {task.task_type === "fms" ? <Card>
        <Text tone="warm" variant="subtitle" weight="semibold">FMS workflow step</Text>
        <Banner tone="warning">This feed row is read-only. Complete it through the workflow so routing, review, evidence, and audit rules remain intact.</Banner>
        <Button busy={busy} label={task.form_template_id ? "Open workflow form" : "Open workflow step"} onPress={() => void openFmsStage()} />
      </Card> : null}

      {task.task_type !== "fms" && checklists.length > 0 ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            Checklist ({checklists.length - remaining}/{checklists.length})
          </Text>
          {checklists.map((item) => (
            <ToggleField
              disabled={done || busy}
              key={item.id}
              label={item.item_text ?? "Checklist item"}
              onChange={(next) =>
                void run(() => updateTask(task.id ?? "", "checklist", { checklistId: item.id, completed: next }))
              }
              required={false}
              value={item.is_completed ?? false}
            />
          ))}
        </Card>
      ) : null}

      {task.task_type !== "fms" && needsForm && task.form_template_id ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            Required form
          </Text>
          <Banner tone="warning">This task cannot be completed until its form is submitted.</Banner>
          <Button
            label="Open the form"
            onPress={() =>
              navigation.navigate("TaskForm", {
                taskId: task.id ?? "",
                formTemplateId: task.form_template_id ?? "",
                taskType: task.task_type,
              })
            }
          />
        </Card>
      ) : null}

      {!done && task.task_type !== "fms" ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            Complete this task
          </Text>
          <TextField
            label="Remark"
            maxLength={2000}
            multiline
            onChangeText={setRemark}
            placeholder="Optional note"
            value={remark}
          />
          <View style={styles.actions}>
            {cardState.showDirectComplete ? <Button
              busy={busy}
              disabled={!cardState.canComplete}
              label="Mark complete"
              onPress={() => void run(() => updateTask(task.id ?? "", "complete", remark ? { remark } : {}))}
            /> : null}
            {cardState.showDirectUpload ? <Button busy={busy} label="Upload" onPress={() => void chooseSource("Upload evidence", { imagesOnly: true }).then((source) => { if (source) void completeWithImage(source); })} variant="secondary" /> : null}
          </View>
          <View style={styles.actions}>
            <Button busy={busy} label="Attach a photo or file" onPress={() => void chooseSource("Attach a file").then((source) => { if (source) void attach(source); })} variant="ghost" />
          </View>
        </Card>
      ) : done ? (
        <Banner tone="success">{`Completed ${formatDateTime(task.actual_datetime, "today")}.`}</Banner>
      ) : null}
    </Screen>
  );
}

/** Exported so the tasks list and this screen agree on the record shape. */
export type TaskDetail = TaskBundle;

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { gap: theme.space.xs },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
}));
