import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  buildManualTaskCreateRequest,
  deriveTaskAuthoringCapability,
  hasPermission,
  voiceDraftGapMessage,
  voiceDraftGaps,
  type ManualTaskMode,
  type ManualTaskPriority,
  type VoiceDraftGap,
} from "@jewelos/core";
import {
  createDelegationTask,
  loadTaskAuthoringReferenceData,
  uploadTaskAttachment,
} from "@jewelos/data/tasks/api";
import type { UploadableFile } from "@jewelos/data/runtime";
import type { VoiceTaskInterpretation } from "@jewelos/data/tasks/voice";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { pickFileFromChooser } from "@/lib/pickFile";
import { useAsyncData } from "@/lib/useAsyncData";
import { log } from "@/lib/log";
import type { RootStackParamList } from "@/navigation/types";
import { DateField } from "@/forms/DateField";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { VoiceTaskCapture } from "./VoiceTaskCapture";

type Navigation = NativeStackNavigationProp<RootStackParamList, "TaskComposer">;

/** A recorder native-module failure must not take the manual task form down with it. */
class VoiceCaptureBoundary extends Component<Readonly<{ children: ReactNode }>, Readonly<{ failed: boolean }>> {
  override state = { failed: false };

  static getDerivedStateFromError(): Readonly<{ failed: boolean }> { return { failed: true }; }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    log.error("startup", "voice capture failed to render", error);
  }

  override render(): ReactNode {
    if (this.state.failed) return <Banner tone="danger">Voice recording is unavailable. You can still assign this task manually.</Banner>;
    return this.props.children;
  }
}

function personLabel(person: Readonly<{ employee_name: string | null; first_name: string | null; last_name: string | null; employee_code: string | null }>): string {
  const name = person.employee_name?.trim()
    || [person.first_name, person.last_name].filter(Boolean).join(" ").trim()
    || "Unnamed user";
  return person.employee_code ? `${name} · ${person.employee_code}` : name;
}

export function TaskComposerScreen() {
  const styles = useStyles();
  const navigation = useNavigation<Navigation>();
  const profile = useProfile();
  const access = useAccess();
  const reference = useAsyncData(loadTaskAuthoringReferenceData, []);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<ManualTaskMode>("task");
  const [plannedDatetime, setPlannedDatetime] = useState("");
  const [priority, setPriority] = useState<ManualTaskPriority>("high");
  const [doerIds, setDoerIds] = useState<readonly string[]>([]);
  const [watcherIds, setWatcherIds] = useState<readonly string[]>([]);
  const [formTemplateId, setFormTemplateId] = useState("");
  const [checklistText, setChecklistText] = useState("");
  const [attachment, setAttachment] = useState<UploadableFile | null>(null);
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceGaps, setVoiceGaps] = useState<readonly VoiceDraftGap[]>([]);
  const [assignmentReason, setAssignmentReason] = useState<string | null>(null);

  const data = reference.data;
  const authoringScope = data ? deriveTaskAuthoringCapability({
    userRole: profile.user_role,
    designationValue: data.designations.find((item) => item.id === profile.designation_id)?.value,
  }).scope : "department";
  const eligiblePeople = useMemo(() => (data?.users ?? []).filter((person) => {
    if (!person.id || person.tenant_id !== profile.tenant_id) return false;
    if (authoringScope === "tenant") return true;
    if (authoringScope === "branch") return person.branch_id === profile.branch_id;
    return person.department_id === profile.department_id;
  }), [authoringScope, data?.users, profile.branch_id, profile.department_id, profile.tenant_id]);
  const peopleOptions = useMemo(() => eligiblePeople.flatMap((person) => person.id
    ? [{ value: person.id, label: personLabel(person) }]
    : []), [eligiblePeople]);
  const watcherOptions = useMemo(() => peopleOptions.filter((option) => !doerIds.includes(option.value)), [doerIds, peopleOptions]);
  const priorityOptions = useMemo(() => (data?.priorities ?? []).flatMap((item) =>
    item.value === "high" || item.value === "medium" || item.value === "low"
      ? [{ value: item.value, label: item.label }]
      : []), [data?.priorities]);
  const outstandingVoiceGaps = useMemo(() => voiceGaps.filter((gap) => gap === "title"
    ? !title.trim()
    : gap === "assignee"
      ? doerIds.length === 0
      : gap === "due"
        ? !plannedDatetime
        : !checklistText.split(/\r?\n/).some((item) => item.trim())), [checklistText, doerIds.length, plannedDatetime, title, voiceGaps]);

  const applyVoiceDraft = (interpretation: VoiceTaskInterpretation) => {
    const { draft } = interpretation;
    setError(null);
    if (draft.title) setTitle(draft.title);
    if (draft.description) setDescription(draft.description);
    setMode(draft.taskType === "checklist" ? "checklist" : "task");
    // Mirrors choosing "Task" by hand, which also discards checklist items.
    setChecklistText(draft.taskType === "checklist" ? draft.checklist.join("\n") : "");
    if (draft.priority) setPriority(draft.priority);
    if (draft.plannedDatetime) setPlannedDatetime(draft.plannedDatetime);
    const assigneeApplies = Boolean(draft.assigneeId) && eligiblePeople.some((person) => person.id === draft.assigneeId);
    if (assigneeApplies && draft.assigneeId) {
      setDoerIds([draft.assigneeId]);
      setWatcherIds((current) => current.filter((id) => id !== draft.assigneeId));
      setAssignmentReason(draft.assignmentReason);
    } else {
      setAssignmentReason(null);
    }
    // Gaps are judged on what the form will hold, as the web composer does: an
    // assignee outside this author's selectable users is dropped above and must
    // surface as "User not selected", and anything already filled by hand is
    // not a gap.
    setVoiceGaps(voiceDraftGaps({
      ...draft,
      title: draft.title || title.trim(),
      assigneeId: assigneeApplies ? draft.assigneeId : doerIds[0] ?? null,
      plannedDatetime: draft.plannedDatetime || plannedDatetime || null,
    }));
  };

  const chooseAttachment = async () => {
    const result = await pickFileFromChooser("Attach image or document");
    if (!result.ok) {
      if (!result.cancelled) setError(result.message);
      return;
    }
    setAttachment(result.file);
    setError(null);
  };

  const uploadCreatedAttachment = async (taskId: string) => {
    if (!attachment) return;
    await uploadTaskAttachment(profile.tenant_id, taskId, attachment);
  };

  const retryAttachment = async () => {
    if (!createdTaskId || !attachment) return;
    setSaving(true);
    setError(null);
    try {
      await uploadCreatedAttachment(createdTaskId);
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The attachment could not be uploaded. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!data || createdTaskId) return;
    const request = buildManualTaskCreateRequest({
      title,
      description,
      plannedDatetime,
      priority,
      mode,
      selectedDoerIds: doerIds,
      selectedWatcherIds: watcherIds,
      formTemplateId,
      checklistItems: checklistText.split(/\r?\n/),
      eligiblePeople: eligiblePeople.flatMap((person) => person.id ? [{
        id: person.id,
        branchId: person.branch_id,
        departmentId: person.department_id,
        eligible: true,
      }] : []),
    });
    if ("error" in request) {
      setError(request.error.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const taskId = await createDelegationTask(
        request.payload,
        [...request.doerIds],
        [...request.watcherIds],
        [...request.checklist],
      );
      if (!attachment) {
        navigation.goBack();
        return;
      }
      setCreatedTaskId(taskId);
      try {
        await uploadCreatedAttachment(taskId);
        navigation.goBack();
      } catch {
        setError("Task created, but its attachment was not uploaded. Retry the attachment without creating another task.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create task.");
    } finally {
      setSaving(false);
    }
  };

  if (reference.loading) return <Screen><LoadingState label="Preparing task creation…" /></Screen>;
  if (reference.error || !data) return <Screen><ErrorState message={reference.error ?? "Task options are unavailable."} onRetry={() => void reference.reload()} /></Screen>;

  return (
    <Screen
      footer={createdTaskId
        ? <Button busy={saving} full label="Retry attachment" onPress={() => void retryAttachment()} />
        : <Button busy={saving} full label="Assign Task" onPress={() => void submit()} />}
      scroll
    >
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {createdTaskId ? <Banner tone="warning">The task is saved. Only the attachment still needs uploading.</Banner> : null}
      {hasPermission(access, "tasks.voice_assign") && !createdTaskId ? <VoiceCaptureBoundary><VoiceTaskCapture onInterpreted={applyVoiceDraft} /></VoiceCaptureBoundary> : null}
      {outstandingVoiceGaps.length > 0 ? <Banner tone="danger">{`Still missing: ${outstandingVoiceGaps.map(voiceDraftGapMessage).join(" ")}`}</Banner> : null}
      {assignmentReason ? <Text tone="muted" variant="caption">Assigned from your voice note · {assignmentReason}</Text> : null}
      <TextField editable={!createdTaskId} label="Task title" maxLength={200} onChangeText={setTitle} required value={title} />
      <TextField editable={!createdTaskId} label="Description" multiline onChangeText={setDescription} value={description} />
      <View style={styles.fieldGroup}>
        <Text tone="warm" variant="label" weight="medium">Task type</Text>
        <OptionPicker
          disabled={Boolean(createdTaskId)}
          label="Task type"
          onChange={(selected) => setMode(selected[0] === "checklist" ? "checklist" : "task")}
          options={[{ value: "task", label: "Task — upload to complete" }, { value: "checklist", label: "Checklist — tick every item" }]}
          selected={[mode]}
        />
      </View>
      {mode === "checklist" ? (
        <TextField
          editable={!createdTaskId}
          helperText="Enter one required checklist item per line."
          label="Checklist items"
          multiline
          onChangeText={setChecklistText}
          required
          value={checklistText}
        />
      ) : null}
      <View style={styles.fieldGroup}>
        <Text tone="warm" variant="label" weight="medium">Assign user *</Text>
        <OptionPicker
          disabled={Boolean(createdTaskId)}
          label="Assign user"
          onChange={(selected) => {
            setDoerIds(selected.slice(0, 1));
            setWatcherIds((current) => current.filter((id) => !selected.includes(id)));
          }}
          options={peopleOptions}
          selected={doerIds}
        />
      </View>
      <View style={styles.fieldGroup}>
        <Text tone="warm" variant="label" weight="medium">Due date and time *</Text>
        <DateField disabled={Boolean(createdTaskId)} invalid={false} label="Due date and time" mode="datetime" onChange={setPlannedDatetime} value={plannedDatetime} />
      </View>
      <View style={styles.fieldGroup}>
        <Text tone="warm" variant="label" weight="medium">Priority</Text>
        <OptionPicker disabled={Boolean(createdTaskId)} label="Priority" onChange={(selected) => {
          const next = selected[0];
          if (next === "high" || next === "medium" || next === "low") setPriority(next);
        }} options={priorityOptions} selected={[priority]} />
      </View>
      <View style={styles.fieldGroup}>
        <Text tone="warm" variant="label" weight="medium">Required form</Text>
        <OptionPicker
          disabled={Boolean(createdTaskId)}
          label="Required form"
          onChange={(selected) => setFormTemplateId(selected[0] ?? "")}
          options={[{ value: "", label: "No form required" }, ...data.forms.map((form) => ({ value: form.id, label: form.name }))]}
          selected={[formTemplateId]}
        />
        <Text tone="muted" variant="caption">The selected form must be completed before this task can be finished.</Text>
      </View>
      <View style={styles.fieldGroup}>
        <Text tone="warm" variant="label" weight="medium">In Loop · read only</Text>
        <OptionPicker disabled={Boolean(createdTaskId)} label="In Loop" multiple onChange={setWatcherIds} options={watcherOptions} selected={watcherIds} />
      </View>
      <Button
        disabled={Boolean(createdTaskId)}
        full
        label={attachment ? `Attachment: ${attachment.name}` : "Attach image or document"}
        onPress={() => void chooseAttachment()}
        variant="secondary"
      />
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  fieldGroup: { gap: theme.space.xs },
}));
