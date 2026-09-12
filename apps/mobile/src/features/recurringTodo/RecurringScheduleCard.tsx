import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { canPauseRecurringTemplate, canRunRecurringTemplateNow } from "@jewelos/core";
import type { RecurringTemplate } from "@jewelos/data/recurringTodo/model";
import { titleCase } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { Text } from "@/ui/Text";

export type RecurringScheduleCardProps = Readonly<{
  template: RecurringTemplate;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}>;

/** One saved schedule, with the four manager actions the web card offers. */
export const RecurringScheduleCard = memo(function RecurringScheduleCard({
  template,
  canManage,
  busy,
  onEdit,
  onToggleActive,
  onRunNow,
  onDelete,
}: RecurringScheduleCardProps) {
  const styles = useStyles();
  const traits = [
    `${titleCase(template.priority ?? "medium")} priority`,
    ...(Array.isArray(template.checklist_items) && template.checklist_items.length
      ? [`${template.checklist_items.length} checklist items`]
      : []),
    ...(template.verification_required ? ["Verification"] : []),
    ...(template.followup_enabled ? ["Follow-ups"] : []),
    ...(template.requires_upload ? ["Upload"] : []),
    ...(template.requires_form ? ["Form"] : []),
  ];
  return (
    <Card accent={template.is_active ? "success" : "none"}>
      <View style={styles.row}>
        <Text numberOfLines={2} style={styles.flex} weight="semibold">
          {template.title}
        </Text>
        {template.recurrence_rule ? <StatusBadge label={template.recurrence_rule} tone="primary" /> : null}
      </View>
      <Text tone="muted" variant="caption">
        {`${titleCase(template.schedule_kind)} | Starts ${template.starts_on ?? "immediately"} | ${
          template.planned_time?.slice(0, 5) ?? ""
        } | ${template.is_active ? "Active" : "Paused"}`}
      </Text>
      <Text tone="muted" variant="caption">
        {traits.join(" · ")}
      </Text>
      {canManage ? (
        <View style={styles.actions}>
          <Button busy={busy} label="Edit" onPress={onEdit} variant="secondary" />
          {canPauseRecurringTemplate(template) ? (
            <Button
              busy={busy}
              label={template.is_active ? "Pause" : "Activate"}
              onPress={onToggleActive}
              variant="secondary"
            />
          ) : null}
          <Button busy={busy} disabled={!canRunRecurringTemplateNow(template)} label="Run now" onPress={onRunNow} />
          <Button busy={busy} label="Delete" onPress={onDelete} variant="danger" />
        </View>
      ) : null}
    </Card>
  );
});

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
    flex: { flex: 1, minWidth: 0 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm, marginTop: theme.space.xs },
  }),
);
