import { memo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { deriveRecurringWorkCardState, recurringStatusPill } from "@jewelos/core";
import type { RecurringInstance } from "@jewelos/data/recurringTodo/model";
import { completeRecurringTaskWithImage, updateTask } from "@jewelos/data/tasks/api";
import { sendRecurringFollowup, verifyRecurringTask } from "@jewelos/data/recurringTodo/api";
import { useProfile } from "@/auth/AuthProvider";
import { pickFileFromChooser } from "@/lib/pickFile";
import { titleCase } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { Pressable } from "@/ui/Pressable";
import { PromptSheet } from "@/ui/PromptSheet";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";

/** The same instant the web card prints, in the same locale and format. */
function dueLabel(value: string): string {
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/** Which question the sheet is currently asking. */
type Ask =
  | { kind: "remark"; title: string }
  | { kind: "followup" }
  | { kind: "reject" }
  | null;

export type RecurringWorkCardProps = Readonly<{
  task: RecurringInstance;
  canManage: boolean;
  followupEnabled: boolean;
  /** Opens the task's required form, the phone's equivalent of the web modal. */
  onOpenForm: (task: RecurringInstance) => void;
  onChanged: () => Promise<void>;
}>;

/**
 * One occurrence in the Recurring / To-Do workspace.
 *
 * Every decision — which actions appear, whether a remark is owed, whether
 * completion is withheld — comes from `deriveRecurringWorkCardState` in
 * `@jewelos/core`, the same function the web card uses.
 */
export const RecurringWorkCard = memo(function RecurringWorkCard({ task, canManage, followupEnabled, onOpenForm, onChanged }: RecurringWorkCardProps) {
  const profile = useProfile();
  const styles = useStyles();
  const state = deriveRecurringWorkCardState({ task, viewerId: profile.id, canManage, followupEnabled });
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const status = recurringStatusPill(task);

  // A failed write stays on the card and stays retryable. Nothing here reports
  // success it did not get.
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const complete = (remark: string | null) =>
    run(() => updateTask(task.id, "complete", remark ? { remark } : {}));

  const act = () => {
    if (state.needsRemark) {
      setAsk({ kind: "remark", title: state.remarkPrompt });
      return;
    }
    void complete(null);
  };

  const toggleChecklist = (id: string, completed: boolean) =>
    run(() => updateTask(task.id, "checklist", { checklistId: id, completed }));

  // The web card accepts a JPEG, PNG or WebP up to 5 MiB, which is what
  // `completeRecurringTaskWithImage` enforces, so the picker offers images only.
  const uploadImage = async () => {
    const picked = await pickFileFromChooser("Upload image to complete", { imagesOnly: true });
    if (!picked.ok) {
      if (!picked.cancelled) setError(picked.message);
      return;
    }
    await run(() => completeRecurringTaskWithImage(profile.tenant_id, task.id, picked.file));
  };

  const answer = (value: string) => {
    const current = ask;
    setAsk(null);
    if (!current) return;
    if (current.kind === "remark") void complete(value);
    if (current.kind === "followup") void run(() => sendRecurringFollowup(task.id, value));
    if (current.kind === "reject") void run(() => verifyRecurringTask(task.id, "rejected", value));
  };

  const deadline = task.revised_datetime ?? task.due_datetime ?? task.planned_datetime;
  return (
    <Card accent={status.tone === "neutral" ? "primary" : status.tone}>
      <View style={styles.row}>
        <Text numberOfLines={2} style={styles.flex} weight="semibold">
          {task.title}
        </Text>
        <StatusBadge label={titleCase(status.label)} tone={status.tone} />
      </View>
      <Text tone="muted" variant="caption">
        {`Start ${dueLabel(task.planned_datetime)} · Due ${dueLabel(deadline)} | ${
          task.assignees.map((item) => item.name).join(", ") || "Coverage required"
        }`}
      </Text>
      {task.description ? (
        <Text numberOfLines={2} tone="muted" variant="small">
          {task.description}
        </Text>
      ) : null}
      {task.on_time_status ? (
        <Text tone={task.on_time_status === "delayed" ? "danger" : "success"} variant="caption">
          {`${
            task.on_time_status === "delayed"
              ? `Delayed by ${task.completion_delay_minutes ?? 0} min`
              : "On time"
          }${task.completion_mode === "on_behalf" ? " · Completed on behalf" : ""}${
            task.completion_remark ? ` · ${task.completion_remark}` : ""
          }`}
        </Text>
      ) : null}
      {task.status === "rejected" && task.verification_note ? (
        <Text tone="danger" variant="caption">{`Returned for rework: ${task.verification_note}`}</Text>
      ) : null}
      {task.followups?.length ? (
        <Pressable
          accessibilityLabel={`${task.followups.length} follow-up${task.followups.length === 1 ? "" : "s"}`}
          accessibilityRole="button"
          onPress={() => setExpanded((open) => !open)}
          style={({ pressed }) => [styles.followups, pressed && styles.pressed]}
        >
          <View>
            <Text tone="muted" variant="caption">
              {`${task.followups.length} follow-up${task.followups.length === 1 ? "" : "s"}${
                task.last_followup_at ? ` · last ${dueLabel(task.last_followup_at)}` : ""
              }`}
            </Text>
            {expanded
              ? task.followups.map((entry) => (
                  <Text key={entry.id} tone="muted" variant="caption">
                    {`${entry.author ?? "System"} · ${dueLabel(entry.created_at)} — ${entry.comment}`}
                  </Text>
                ))
              : null}
          </View>
        </Pressable>
      ) : null}
      {state.showChecklist
        ? task.checklist.map((item) => (
            <Pressable
              accessibilityLabel={item.item_text ?? "Checklist item"}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: Boolean(item.is_completed) }}
              disabled={busy}
              key={item.id}
              onPress={() => void toggleChecklist(item.id, !item.is_completed)}
              style={({ pressed }) => [styles.checkRow, pressed && styles.pressed]}
            >
              <View style={styles.checkRowInner}>
                <View style={[styles.box, item.is_completed ? styles.boxOn : null]}>
                  {item.is_completed ? (
                    <Text tone="inverse" variant="caption" weight="bold">
                      ✓
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.flex} tone="muted" variant="small">
                  {item.item_text}
                </Text>
              </View>
            </Pressable>
          ))
        : null}
      {task.requires_form && !state.showCompleteForm && task.status !== "completed" ? (
        <CardRow label="Form" value="Waiting for coverage to be resolved" />
      ) : null}
      <View style={styles.actions}>
        {state.showCompleteForm ? (
          <Button
            busy={busy}
            disabled={state.completeFormDisabled}
            label="Complete form"
            onPress={() => onOpenForm(task)}
          />
        ) : null}
        {state.showCompleteChecklist ? <Button busy={busy} label="Complete checklist" onPress={act} /> : null}
        {state.showComplete ? <Button busy={busy} label="Complete" onPress={act} /> : null}
        {state.showUpload ? (
          <Button busy={busy} label="Upload image to complete" onPress={() => void uploadImage()} variant="secondary" />
        ) : null}
        {state.showFollowup ? (
          <Button busy={busy} label="Follow up" onPress={() => setAsk({ kind: "followup" })} variant="secondary" />
        ) : null}
        {state.showVerify ? (
          <>
            <Button busy={busy} label="Verify" onPress={() => void run(() => verifyRecurringTask(task.id, "verified", ""))} />
            <Button busy={busy} label="Reject" onPress={() => setAsk({ kind: "reject" })} variant="danger" />
          </>
        ) : null}
      </View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {/*
        Mounted only while this card is actually asking something. A `PromptSheet`
        is a `Modal`, and a list of a hundred occurrences that each kept one
        permanently mounted was a hundred modals competing for the memory the
        list itself needs.
      */}
      {ask ? (
        <PromptSheet
          busy={busy}
          multiline={ask.kind !== "remark"}
          onCancel={() => setAsk(null)}
          onSubmit={answer}
          submitLabel={ask.kind === "reject" ? "Reject" : ask.kind === "followup" ? "Send" : "Complete"}
          title={
            ask.kind === "remark"
              ? ask.title
              : ask.kind === "followup"
                ? "Follow-up message"
                : "Why is this rejected?"
          }
          visible
        />
      ) : null}
    </Card>
  );
});

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
    flex: { flex: 1, minWidth: 0 },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm, marginTop: theme.space.xs },
    followups: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.space.sm, gap: theme.space.xs },
    checkRow: { borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.space.sm, minHeight: 44, justifyContent: "center" },
    checkRowInner: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
    box: { width: 18, height: 18, borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center", justifyContent: "center" },
    boxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
    pressed: { opacity: 0.8 },
  }),
);
