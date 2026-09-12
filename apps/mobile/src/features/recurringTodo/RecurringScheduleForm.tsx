import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  buildRecurringTemplatePayload,
  recurringTemplateFrequency,
  validateRecurringTemplateDraft,
  RECURRING_FREQUENCIES,
  type Json,
} from "@jewelos/core";
import type { TaskReferenceData } from "@jewelos/data/tasks/api";
import type { RecurringTemplate } from "@jewelos/data/recurringTodo/model";
import { DateField } from "@/forms/DateField";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { OptionPicker } from "@/ui/OptionPicker";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { Banner } from "@/ui/states";

/** Today in Kolkata, the default the web form starts a new schedule on. */
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export type RecurringScheduleFormProps = Readonly<{
  data: TaskReferenceData;
  /** `null` for a new schedule, a template to edit an existing one. */
  template: RecurringTemplate | null;
  onCancel: () => void;
  onSave: (id: string | null, payload: Json) => Promise<void>;
}>;

/**
 * The phone form of the web New / Edit recurring schedule dialog.
 *
 * The three numbered sections, their labels, their options and their
 * validation are the web form's; only the controls change. Validation and the
 * saved payload both come from `@jewelos/core`, so a schedule created here and
 * one created in a browser are the same row.
 */
export function RecurringScheduleForm({ data, template, onCancel, onSave }: RecurringScheduleFormProps) {
  const styles = useStyles();
  const [user, setUser] = useState(template?.default_assignee_user_id ?? "");
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [frequency, setFrequency] = useState(() => recurringTemplateFrequency(template));
  const [start, setStart] = useState(template?.starts_on ?? todayKey());
  const [startTime, setStartTime] = useState(template?.planned_time?.slice(0, 5) ?? "");
  const [dueTime, setDueTime] = useState(
    template?.due_time?.slice(0, 5) ?? template?.planned_time?.slice(0, 5) ?? "",
  );
  const [mode, setMode] = useState<"task" | "checklist">(
    template?.task_type === "delegation" ? "task" : "checklist",
  );
  const [buddy, setBuddy] = useState(template?.buddy_assignment_allowed ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const assignee = useMemo(() => data.users.find((candidate) => candidate.id === user), [data.users, user]);
  const draft = { title, description, frequency, start, startTime, dueTime, mode, buddy };

  const submit = async () => {
    const invalid = validateRecurringTemplateDraft(draft, assignee ?? null);
    if (invalid || !assignee) {
      setError(invalid);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(template?.id ?? null, buildRecurringTemplatePayload(draft, assignee) as Json);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save task");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.form}>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <View style={styles.section}>
        <Text tone="muted" variant="caption" weight="semibold">
          1 · ASSIGNMENT
        </Text>
        <OptionPicker
          label="Assign To User *"
          onChange={(selected) => setUser(selected[0] ?? "")}
          options={data.users
            .filter((candidate) => candidate.id)
            .map((candidate) => ({ value: candidate.id, label: candidate.employee_name ?? "" }))}
          placeholder="Select user"
          selected={user ? [user] : []}
        />
        {assignee ? (
          <Text tone="muted" variant="small">
            Branch and department are automatically taken from this user’s profile.
          </Text>
        ) : null}
        <TextField
          label="Core Task *"
          onChangeText={setTitle}
          placeholder="Enter the responsibility / task name"
          required
          value={title}
        />
        <TextField
          label="Description"
          multiline
          onChangeText={setDescription}
          placeholder="What should be completed?"
          value={description}
        />
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="caption" weight="semibold">
          2 · SCHEDULE
        </Text>
        <OptionPicker
          label="Frequency *"
          onChange={(selected) => setFrequency(selected[0] ?? "daily")}
          options={RECURRING_FREQUENCIES.map(([value, label]) => ({ value, label }))}
          selected={[frequency]}
        />
        <DateField disabled={false} invalid={!start} label="Task Start Date *" mode="date" onChange={setStart} value={start} />
        <DateField disabled={false} invalid={!startTime} label="Scheduled Start Time" mode="time" onChange={setStartTime} value={startTime} />
        <DateField disabled={false} invalid={!dueTime} label="Due Time" mode="time" onChange={setDueTime} value={dueTime} />
        {!start ? <Banner tone="info">Select a start date.</Banner> : null}
      </View>

      <View style={styles.section}>
        <Text tone="muted" variant="caption" weight="semibold">
          3 · TASK CONTROLS
        </Text>
        <OptionPicker
          label="Task Type *"
          onChange={(selected) => setMode(selected[0] === "task" ? "task" : "checklist")}
          options={[
            { value: "checklist", label: "CHECKBOX — Tap to complete" },
            { value: "task", label: "TASK — Upload image to complete" },
          ]}
          selected={[mode]}
        />
        <OptionPicker
          label="Buddy Assignment Allowed"
          onChange={(selected) => setBuddy(selected[0] === "yes")}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          selected={[buddy ? "yes" : "no"]}
        />
      </View>

      <View style={styles.actions}>
        <Button label="Cancel" onPress={onCancel} variant="secondary" />
        <Button
          busy={saving}
          label={saving ? "Saving…" : template ? "Update Task" : "Save Task"}
          onPress={() => void submit()}
          style={styles.grow}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    form: { gap: theme.space.md },
    section: {
      gap: theme.space.sm,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: theme.radius.lg,
      padding: theme.space.md,
    },
    actions: { flexDirection: "row", gap: theme.space.sm },
    grow: { flex: 1 },
  }),
);
