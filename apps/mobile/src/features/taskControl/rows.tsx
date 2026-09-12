import { memo } from "react";
import { StyleSheet, View } from "react-native";
import {
  evidenceCellState,
  evidenceFileSize,
  prettyTemplateDate,
  prettyTemplateTime,
  taskRowTone,
} from "@jewelos/core";
import type { TaskAttachmentSummary, TaskRow } from "@jewelos/data/taskEvidence/types";
import {
  templateCanActivate,
  templateFrequencyLabel,
  templateSourceLabel,
  templateStatusLabel,
  templateWorkTypeLabel,
  type TaskTemplateDirectoryRow,
} from "@jewelos/data/taskTemplates/api";
import { titleCase } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { Pressable } from "@/ui/Pressable";
import { Text } from "@/ui/Text";

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * One row of the web `TasksTab`. Evidence opens through a short-lived signed
 * URL requested at tap time, so no durable object link is ever put on screen.
 */
export const EvidenceTaskCard = memo(function EvidenceTaskCard({
  row,
  onOpenFile,
}: {
  row: TaskRow;
  onOpenFile: (file: TaskAttachmentSummary) => void;
}) {
  const styles = useStyles();
  const tone = taskRowTone(row);
  const evidence = evidenceCellState(row);
  return (
    <Card accent={tone === "success" ? "success" : tone === "danger" ? "danger" : "warning"}>
      <View style={styles.headRow}>
        <Text numberOfLines={2} style={styles.flex} weight="semibold">
          {row.task_title}
        </Text>
        <StatusBadge
          label={row.overdue && row.task_status !== "completed" ? "Overdue" : titleCase(row.task_status)}
          tone={tone === "success" ? "success" : tone === "danger" ? "danger" : "warning"}
        />
      </View>
      <Text numberOfLines={1} tone="muted" variant="caption">
        {`${row.assignee_names ?? "Unassigned"} · ${row.branch_name ?? "No branch"}${
          row.department_name ? ` · ${row.department_name}` : ""
        }`}
      </Text>
      <Text tone="muted" variant="caption">
        {`Due ${dateTime(row.due_datetime ?? row.planned_datetime)}${
          row.actual_datetime ? ` · Completed ${dateTime(row.actual_datetime)}` : ""
        }`}
      </Text>
      <View style={styles.chips}>
        <StatusBadge label={row.is_upload_work ? "Upload" : "Checkbox"} tone={row.is_upload_work ? "neutral" : "primary"} />
      </View>
      {evidence === "files" ? (
        <View style={styles.chips}>
          {row.attachments.map((file) => (
            <Pressable
              accessibilityLabel={`Open ${file.original_filename ?? "Unnamed file"}`}
              accessibilityRole="button"
              key={file.attachment_id}
              onPress={() => onOpenFile(file)}
              style={({ pressed }) => [styles.fileChip, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={styles.flex} variant="caption">
                {file.original_filename ?? "Unnamed file"}
              </Text>
              <Text tone="muted" variant="caption">
                {evidenceFileSize(file.size_bytes)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : evidence === "missing" ? (
        <Text tone="warning" variant="caption" weight="medium">
          Required, no file yet
        </Text>
      ) : (
        <Text tone="muted" variant="caption">
          No file required
        </Text>
      )}
    </Card>
  );
});

/**
 * One row of the web `TemplatesTab`. The twelve-column table becomes a card
 * carrying the same twelve values, with the same four actions in the same
 * order; activation stays blocked until a start date exists, as on web.
 */
export const TemplateCard = memo(function TemplateCard({
  row,
  busy,
  canManage,
  onEdit,
  onSchedule,
  onToggle,
  onDelete,
}: {
  row: TaskTemplateDirectoryRow;
  busy: boolean;
  canManage: boolean;
  onEdit: () => void;
  onSchedule: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const styles = useStyles();
  const status = templateStatusLabel(row);
  const activateBlocked = !row.is_active && !templateCanActivate(row);
  return (
    <Card accent={status === "ACTIVE" ? "success" : status === "INACTIVE" ? "none" : "warning"}>
      <View style={styles.headRow}>
        <Text numberOfLines={2} style={styles.flex} weight="semibold">
          {row.title}
        </Text>
        <StatusBadge
          label={titleCase(status)}
          tone={status === "ACTIVE" ? "success" : status === "INACTIVE" ? "neutral" : "warning"}
        />
      </View>
      <CardRow label="User" value={row.assignee_name ?? "Not set"} />
      <CardRow label="Department" value={row.department_name ?? "—"} />
      <CardRow label="Task Type" value={templateWorkTypeLabel(row)} />
      <CardRow label="Frequency" value={templateFrequencyLabel(row)} />
      <CardRow label="Start Date" value={prettyTemplateDate(row.starts_on)} />
      <CardRow label="Start" value={prettyTemplateTime(row.planned_time)} />
      <CardRow label="Due" value={prettyTemplateTime(row.due_time ?? row.planned_time)} />
      <CardRow label="Evidence" value={row.requires_upload ? "Required" : "Not Required"} />
      <CardRow label="Source" value={templateSourceLabel(row)} />
      {canManage ? (
        <View style={styles.actions}>
          <Button busy={busy} label="Edit" onPress={onEdit} variant="secondary" />
          <Button busy={busy} label="Schedule" onPress={onSchedule} variant="secondary" />
          <Button
            busy={busy}
            disabled={activateBlocked}
            label={row.is_active ? "Deactivate" : "Activate"}
            onPress={onToggle}
            variant="secondary"
          />
          <Button busy={busy} label="Delete" onPress={onDelete} variant="danger" />
        </View>
      ) : null}
      {activateBlocked ? (
        <Text tone="muted" variant="caption">
          Set a task start date before activating this schedule.
        </Text>
      ) : null}
    </Card>
  );
});

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    headRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
    flex: { flex: 1, minWidth: 0 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs, marginTop: theme.space.xs },
    fileChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: theme.space.xs,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.space.sm,
      minHeight: theme.touchTarget,
      maxWidth: "100%",
    },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm, marginTop: theme.space.xs },
    pressed: { opacity: 0.8 },
  }),
);
