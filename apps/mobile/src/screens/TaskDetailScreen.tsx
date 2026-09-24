import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  deriveTaskCardState,
  deriveTaskMutationCapability,
  formatIndiaDateTime,
  taskBuddyCoverageLabel,
  taskEvidenceFileError,
  taskEvidenceLabel,
  taskFrequencyLabel,
  taskScheduleStateLabel,
  taskTypeLabel,
  taskVerificationLabel,
  type Tables,
} from "@jewelos/core";
import {
  loadFmsTaskDeepLink,
  loadFmsTaskStageLink,
  reviseTask,
  updateTask,
  uploadAndCompleteTask,
  uploadTaskAttachment,
  type TaskBundle,
} from "@jewelos/data/tasks/api";
import { addTaskComment, loadTaskComments } from "@jewelos/data/tasks/comments";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDateTime } from "@/lib/format";
import { errorText, log } from "@/lib/log";
import { pickFileFromChooser } from "@/lib/pickFile";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { DateField } from "@/forms/DateField";
import { ToggleField } from "@/forms/ToggleField";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";
import { fmsAssignedWorkRouteForTask, navigateFmsAssignedWork } from "@/features/fms/assignedWorkNavigation";
import { TaskAttachmentList } from "@/features/tasks/TaskAttachmentList";
import { TaskRemarkComposer, TaskRemarksCard } from "@/features/tasks/TaskRemarks";
import { findWorkspaceTask, loadTaskWorkspace } from "@/features/tasks/taskWorkspace";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "TaskDetail">;

/** The web card's expanded panel: every value comes from the bounded feed row. */
function detailRows(task: TaskBundle, statusLabel: string): Array<{ label: string; value: string }> {
  const checklist = task.checklists ?? [];
  const done = checklist.filter((item) => item.is_completed).length;
  const revised = formatIndiaDateTime(task.revised_datetime);
  const due = formatIndiaDateTime(task.due_datetime);
  const rows: Array<{ label: string; value: string | null | undefined }> = [
    { label: "Assigned to", value: task.assigneeName },
    { label: "Branch", value: task.branch_name },
    { label: "Department", value: task.department_name },
    { label: "Task type", value: taskTypeLabel(task.task_type) },
    { label: "Core task", value: task.core_task_label },
    { label: "Frequency", value: taskFrequencyLabel(task.schedule_kind) },
    { label: "Start", value: formatIndiaDateTime(task.planned_datetime) },
    { label: "Due", value: revised ? `Revised deadline: ${revised}${due ? `\nOriginal due: ${due}` : ""}` : due },
    { label: "Priority", value: task.priority ? task.priority[0]!.toUpperCase() + task.priority.slice(1) : null },
    { label: "Evidence", value: taskEvidenceLabel(task, task.hasAttachment) },
    { label: "Verification", value: taskVerificationLabel(task) },
    { label: "Verifier", value: task.verifierName },
    { label: "Buddy coverage", value: taskBuddyCoverageLabel(task.buddy_assignment_allowed) },
    { label: "Schedule state", value: taskScheduleStateLabel(task) },
    { label: "Status", value: statusLabel },
    { label: "Checklist", value: checklist.length > 0 ? `${done} of ${checklist.length} complete` : null },
  ];
  return rows.flatMap((row) => row.value ? [{ label: row.label, value: row.value }] : []);
}

/**
 * One task, and every action it allows — the web task card's expanded panel.
 *
 * Which actions are offered comes from `deriveTaskCardState` in core, the same
 * decision the task list uses, and the server re-checks all of it. Hiding a
 * button is a courtesy; `update_task_with_audit` is the actual gate.
 */
export function TaskDetailScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const [remark, setRemark] = useState("");
  const [revision, setRevision] = useState("");
  const [revisionReason, setRevisionReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attachmentsVersion, setAttachmentsVersion] = useState(0);

  // The same two feeds the Tasks list shows, so a delegated or coverage-blocked
  // task opened from the list is always found here.
  const load = useCallback(() => loadTaskWorkspace(profile), [profile]);
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);
  const task = useMemo(() => findWorkspaceTask(data, params.taskId), [data, params.taskId]);
  // FMS feed rows are workflow stages, not task records, so they carry no remark thread.
  const remarksTaskId = task && task.task_type !== "fms" ? task.id : null;
  const loadRemarks = useCallback(async () => (remarksTaskId ? loadTaskComments(remarksTaskId) : []), [remarksTaskId]);
  const remarks = useAsyncData(loadRemarks, [loadRemarks]);
  const refreshRemarks = remarks.refresh;
  useEffect(() => subscribeToTenantRealtime(profile.tenant_id, ["tasks"], () => {
    void refresh();
    void refreshRemarks();
  }), [profile.tenant_id, refresh, refreshRemarks]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refresh();
      setAttachmentsVersion((value) => value + 1);
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

  const checklists: Tables<"task_checklists">[] = task.checklists ?? [];
  const capability = deriveTaskMutationCapability({
    assigneeIds: task.assignees.map((assignee) => assignee.id),
    isWatcher: task.isWatchedByViewer,
    viewerId: profile.id,
    viewerRole: profile.user_role,
  });
  const state = deriveTaskCardState({ task, hasAttachment: task.hasAttachment, hasFormSubmission: task.hasFormSubmission, checklists, capability });
  const { blocked, completed, formOnlyAction, overdue, readOnly, requiresEvidence } = state;
  const fmsFormAction = task.task_type === "fms" && Boolean(task.requires_form) && !completed;
  const fmsStageAction = task.task_type === "fms" && !task.requires_form && !completed;
  const statusLabel = completed ? "Completed" : blocked ? "Coverage required" : overdue ? "Overdue" : task.status === "in_progress" ? "In Progress" : "Pending";
  const remarkMissing = Boolean(task.requires_remark) && !remark.trim();
  const description = task.description?.trim();

  const pickEvidence = async () => {
    const picked = await pickFileFromChooser("Upload evidence");
    if (!picked.ok) {
      if (!picked.cancelled) setActionError(picked.message);
      return null;
    }
    const invalid = taskEvidenceFileError(picked.file);
    if (invalid) {
      setActionError(invalid);
      return null;
    }
    return picked.file;
  };

  const uploadEvidence = async (complete: boolean) => {
    const file = await pickEvidence();
    if (!file) return;
    await run(() => complete
      ? uploadAndCompleteTask(profile.tenant_id, task.id ?? "", file)
      : uploadTaskAttachment(profile.tenant_id, task.id ?? "", file));
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

  const submitRevision = () => {
    if (!revision || !revisionReason.trim()) {
      setActionError("Enter the revised date and a reason.");
      return;
    }
    void run(async () => {
      await reviseTask(task.id ?? "", new Date(revision).toISOString(), revisionReason);
      setRevision("");
      setRevisionReason("");
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
      footer={remarksTaskId ? (
        <TaskRemarkComposer
          onSend={async (comment) => {
            await addTaskComment(remarksTaskId, comment);
            await refreshRemarks();
          }}
        />
      ) : undefined}
      scroll
    >
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      <View style={styles.header}>
        <Text style={completed ? styles.completedTitle : undefined} variant="title" weight="semibold">
          {task.title ?? "Untitled task"}
        </Text>
        <View style={styles.badges}>
          <StatusBadge
            label={statusLabel}
            tone={completed ? "success" : blocked ? "warning" : overdue ? "danger" : "neutral"}
          />
          {capability.watcherLabel ? <StatusBadge label={capability.watcherLabel} tone="primary" /> : null}
          {task.task_type === "fms" ? <StatusBadge label="FMS" tone="primary" /> : null}
          {task.coverageOriginalAssigneeName ? <StatusBadge label={`Covering for: ${task.coverageOriginalAssigneeName}`} tone="primary" /> : null}
        </View>
      </View>

      <Card>
        <Text tone={description ? "default" : "muted"} variant="body" style={description ? undefined : styles.italic}>
          {description ?? "No description provided"}
        </Text>
        {detailRows(task, statusLabel).map((row) => <CardRow key={row.label} label={row.label} value={row.value} />)}
        {task.hasAttachment && task.id ? <TaskAttachmentList refreshKey={attachmentsVersion} taskId={task.id} /> : null}
      </Card>

      {blocked ? (
        <Banner tone="warning">
          Coverage required. An authorized manager must resolve coverage through a future database-backed workflow; no simulated resolution is available here.
        </Banner>
      ) : null}

      {!formOnlyAction && checklists.length > 0 ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            {`Checklist (${state.checklistProgress.completedItems}/${state.checklistProgress.totalItems})`}
          </Text>
          {checklists.map((item) => (
            <ToggleField
              disabled={busy || completed || readOnly || blocked}
              key={item.id}
              label={item.item_text ?? "Checklist item"}
              onChange={(next) =>
                void run(() => updateTask(task.id ?? "", "checklist", { checklistId: item.id, completed: next }))
              }
              required={item.is_required ?? false}
              value={item.is_completed ?? false}
            />
          ))}
        </Card>
      ) : null}

      {fmsFormAction && !blocked ? (
        <Button busy={busy} disabled={!task.form_template_id} full label="Complete FMS form" onPress={() => void openFmsStage()} />
      ) : fmsStageAction && !blocked ? (
        <Button busy={busy} full label="Open FMS workflow" onPress={() => void openFmsStage()} />
      ) : formOnlyAction && !readOnly && !blocked ? (
        <Button
          disabled={busy || !task.form_template_id}
          full
          label="Complete form"
          onPress={() =>
            navigation.navigate("TaskForm", {
              taskId: task.id ?? "",
              formTemplateId: task.form_template_id ?? "",
              taskType: task.task_type,
            })
          }
        />
      ) : null}

      {!formOnlyAction && !readOnly && requiresEvidence && !completed ? (
        <Button
          busy={busy}
          full
          label={task.hasAttachment ? "Evidence uploaded · add another" : "Upload required evidence"}
          onPress={() => void uploadEvidence(false)}
          variant="secondary"
        />
      ) : null}

      {!formOnlyAction && !readOnly && task.requires_remark && !completed ? (
        <TextField label="Completion remark" maxLength={2000} multiline onChangeText={setRemark} value={remark} />
      ) : null}

      {state.showDirectUpload ? (
        <Button busy={busy} full label="Upload" onPress={() => void uploadEvidence(true)} />
      ) : state.showDirectComplete ? (
        <Button
          busy={busy}
          disabled={!state.canComplete || remarkMissing}
          full
          label="Complete"
          onPress={() => void run(() => updateTask(task.id ?? "", "complete", { remark }))}
        />
      ) : null}

      {task.task_type === "fms" ? <Banner>FMS work is completed in its protected workflow runner.</Banner> : null}

      {state.showReviseForm ? (
        <Card>
          <View style={styles.group}>
            <Text tone="warm" variant="label" weight="medium">Revised date *</Text>
            <DateField disabled={busy} invalid={false} label="Revised date" mode="datetime" onChange={setRevision} value={revision} />
          </View>
          <TextField label="Reason" maxLength={500} onChangeText={setRevisionReason} required value={revisionReason} />
          <Button busy={busy} label="Revise" onPress={submitRevision} />
        </Card>
      ) : null}

      {completed ? <Banner tone="success">{`Completed ${formatDateTime(task.actual_datetime, "today")}.`}</Banner> : null}

      {remarksTaskId ? (
        <TaskRemarksCard comments={remarks.data} error={remarks.error} loading={remarks.loading} viewerId={profile.id} />
      ) : null}
    </Screen>
  );
}

/** Exported so the tasks list and this screen agree on the record shape. */
export type TaskDetail = TaskBundle;

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { gap: theme.space.xs },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  group: { gap: theme.space.xs },
  italic: { fontStyle: "italic" },
  completedTitle: { textDecorationLine: "line-through", color: theme.colors.textMuted },
}));
