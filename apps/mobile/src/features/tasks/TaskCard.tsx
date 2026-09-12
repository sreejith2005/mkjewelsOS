import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  FileUp,
  PauseCircle,
  Users,
} from "lucide-react-native";
import {
  deriveTaskCardState,
  effectiveTaskDeadline,
  type Enums,
  type TaskMutationCapability,
} from "@jewelos/core";
import type { TaskBundle } from "@jewelos/data/tasks/api";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";

/**
 * A port of `apps/web/src/features/tasks/TaskCard.tsx`.
 *
 * Which actions this card offers is decided by `deriveTaskCardState` in
 * `@jewelos/core` — the same function the web card calls — so the two cannot
 * disagree about when a task may be completed, when it is read-only, or whether
 * an outstanding checklist blocks anything. Do not reintroduce those rules here.
 *
 * The class strings are the web component's, unchanged, apart from `hover:`
 * variants (meaningless on a touch screen) and `sm:` variants (this app is
 * always at the phone breakpoint).
 */
export type TaskCardAction =
  | { checklistId: string; completed: boolean; kind: "checklist" }
  | { kind: "complete"; remark: string }
  | { kind: "upload_and_complete" }
  | { kind: "fill_form" }
  | { datetime: string; kind: "revise"; reason: string };

const PRIORITY_CLASS: Record<Enums<"task_priority">, string> = {
  high: "border-task-overdue/40 bg-task-overdue/10",
  medium: "border-task-warning/40 bg-task-warning/10",
  low: "border-task-border bg-task-muted",
};

const PRIORITY_TEXT: Record<Enums<"task_priority">, string> = {
  high: "text-task-overdue",
  medium: "text-task-text",
  low: "text-task-text-muted",
};

export function TaskCard({
  capability,
  categoryLabel,
  onAction,
  onOpenDetails,
  task: taskInput,
}: {
  capability: TaskMutationCapability;
  categoryLabel: string;
  onAction: (action: TaskCardAction) => Promise<void>;
  /** The web expands in place; a phone opens the detail screen instead. */
  onOpenDetails: () => void;
  task: TaskBundle;
}) {
  const task = { ...taskInput, planned_datetime: effectiveTaskDeadline(taskInput) };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    canComplete,
    checklistProgress,
    completed,
    blocked,
    formOnlyAction,
    overdue,
    showDirectComplete: canShowDirectComplete,
    showDirectUpload: canShowDirectUpload,
  } = deriveTaskCardState({
    task,
    hasAttachment: task.hasAttachment,
    hasFormSubmission: task.hasFormSubmission,
    checklists: task.checklists,
    capability,
  });

  const act = async (action: TaskCardAction) => {
    setBusy(true);
    setError(null);
    try {
      await onAction(action);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Task update failed");
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = completed
    ? "Completed"
    : blocked
      ? "Coverage required"
      : overdue
        ? "Overdue"
        : task.status === "in_progress"
          ? "In Progress"
          : "Pending";
  const StatusIcon = completed ? CheckCircle2 : blocked ? PauseCircle : overdue ? AlertTriangle : Clock;

  return (
    <View
      className={cn(
        "overflow-hidden rounded-2xl border bg-task-bg",
        completed
          ? "border-success/40 opacity-80"
          : blocked
            ? "border-task-warning/60"
            : overdue
              ? "border-task-overdue/50"
              : task.isWatchedByViewer
                ? "border-task-accent/50"
                : "border-task-border",
      )}
    >
      <View className="flex-row items-start gap-2 p-4">
        <Pressable
          accessibilityHint="Opens the task"
          accessibilityLabel={task.title ?? "Task"}
          accessibilityRole="button"
          className="min-w-0 flex-1 flex-row items-start gap-3"
          onPress={onOpenDetails}
        >
          <StatusIcon
            className={cn(
              "mt-0.5",
              completed
                ? "text-success"
                : blocked
                  ? "text-task-warning"
                  : overdue
                    ? "text-task-overdue"
                    : "text-task-accent",
            )}
            size={20}
          />
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text
                className={cn(
                  "text-[15px] font-semibold leading-snug text-task-text",
                  completed && "text-task-text-muted line-through",
                )}
              >
                {task.title}
              </Text>
              <View
                className={cn(
                  "rounded-full border px-2 py-0.5",
                  completed
                    ? "border-success/40 bg-success/10"
                    : blocked
                      ? "border-task-warning/50 bg-task-warning/10"
                      : overdue
                        ? "border-task-overdue/40 bg-task-overdue/10"
                        : "border-task-border bg-task-muted",
                )}
              >
                <Text
                  className={cn(
                    "text-[10px] font-semibold",
                    completed
                      ? "text-success"
                      : blocked
                        ? "text-task-text"
                        : overdue
                          ? "text-task-overdue"
                          : "text-task-text-muted",
                  )}
                >
                  {statusLabel}
                </Text>
              </View>
              {capability.watcherLabel ? (
                <View className="flex-row items-center gap-1 rounded-full bg-task-accent-soft px-2 py-0.5">
                  <Eye className="text-task-text" size={12} />
                  <Text className="text-[10px] font-semibold text-task-text">{capability.watcherLabel}</Text>
                </View>
              ) : null}
              {task.coverageOriginalAssigneeName ? (
                <View className="rounded-full border border-task-accent/40 bg-task-accent-soft px-2 py-0.5">
                  <Text className="text-[10px] font-semibold text-task-text">
                    Covering for: {task.coverageOriginalAssigneeName}
                  </Text>
                </View>
              ) : null}
            </View>

            <View className="mt-2 flex-row flex-wrap items-center gap-x-3 gap-y-1">
              <View className="min-w-0 flex-row items-center gap-1">
                <Users className="text-task-text-muted" size={12} />
                <Text className="text-xs text-task-text-muted" numberOfLines={1}>
                  {task.assigneeName}
                </Text>
              </View>
              <Text className="text-xs text-task-text-muted">
                {task.planned_datetime ? formatDateTime(task.planned_datetime) : "Unscheduled"}
              </Text>
              {task.priority ? (
                <View className={cn("rounded-full border px-2 py-0.5", PRIORITY_CLASS[task.priority])}>
                  <Text className={cn("text-xs capitalize", PRIORITY_TEXT[task.priority])}>{task.priority}</Text>
                </View>
              ) : null}
              <Text className="text-xs text-task-text-muted">{categoryLabel}</Text>
            </View>

            {!formOnlyAction && task.checklists.length > 0 ? (
              <View className="mt-3 flex-row items-center gap-2">
                <View className="h-1.5 flex-1 overflow-hidden rounded-full bg-task-muted">
                  <View
                    className="h-full rounded-full bg-task-accent"
                    style={{ width: `${checklistProgress.displayPercent}%` }}
                  />
                </View>
                <Text className="text-xs tabular-nums text-task-text-muted">
                  {checklistProgress.completedItems}/{checklistProgress.totalItems}
                </Text>
              </View>
            ) : null}
          </View>

          <ChevronDown className="shrink-0 -rotate-90 text-task-text-muted" size={16} />
        </Pressable>

        {canShowDirectUpload ? (
          <Button
            accessibilityLabel={`Upload task: ${task.title ?? "task"}`}
            className="shrink-0 bg-task-accent"
            disabled={busy}
            onPress={() => void act({ kind: "upload_and_complete" })}
          >
            <FileUp className="text-task-text" size={16} />
            <Text className="text-sm font-semibold text-task-text">Upload</Text>
          </Button>
        ) : canShowDirectComplete ? (
          <Button
            accessibilityLabel={`Complete task: ${task.title ?? "task"}`}
            className="shrink-0 bg-task-accent"
            disabled={busy || !canComplete || Boolean(task.requires_remark)}
            onPress={() => void act({ kind: "complete", remark: "" })}
          >
            <CheckCircle2 className="text-task-text" size={16} />
            <Text className="text-sm font-semibold text-task-text">Complete</Text>
          </Button>
        ) : formOnlyAction ? (
          <Button
            accessibilityLabel={`Fill form for: ${task.title ?? "task"}`}
            className="shrink-0 bg-task-accent"
            disabled={busy}
            onPress={() => void act({ kind: "fill_form" })}
            label="Form"
          />
        ) : null}
      </View>

      {error ? (
        <View className="border-t border-task-border bg-task-muted p-4">
          <Notice tone="danger">{error}</Notice>
        </View>
      ) : null}
    </View>
  );
}
