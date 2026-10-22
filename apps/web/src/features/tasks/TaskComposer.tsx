import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, Check, ChevronDown, FileText, Flag, Paperclip, Plus, Rocket, Users, UserRoundCheck, X } from "lucide-react";
import { AS_NEEDED_TRIGGER_SUGGESTIONS, SCHEDULE_PRESETS, buildManualTaskCreateRequests, buildScheduledTaskPayload, canShareManualTask, kolkataDateKey, taskPriorityChoices, validateScheduledTaskDraft, voiceDraftGapMessage, voiceDraftGaps, type Enums, type Json, type ManualTaskAssignmentMode, type ManualTaskCreateRequest, type ScheduledTaskDraft, type VoiceDeadline, type VoiceDraftGap } from "@jewelos/core";
import type { UserProfile } from "@/types";
import { Button, Modal, Notice } from "@/components/ui";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ChipSelector } from "./ChipSelector";
import type { TaskReferenceData } from "./api";
import { AssigneePicker } from "@/components/assignees/AssigneePicker";
import { VoiceTaskCapture } from "./VoiceTaskCapture";
import type { VoiceTaskInterpretation } from "./voiceApi";
import { ScheduleFields, type CalendarTiming } from "./schedule/ScheduleFields";
import { ScheduleOptions, type ScheduleOptionValues } from "./schedule/ScheduleOptions";

type Panel = "users" | "due" | "priority" | "form" | "watchers" | null;

/** One-time is the existing task; the other two save a schedule template. */
type ScheduleType = "once" | "recurring" | "as_needed";
const SCHEDULE_TYPES: ReadonlyArray<readonly [ScheduleType, string, string]> = [
  ["once", "One-time", "A single task with a due date."],
  ["recurring", "Recurring", "Repeats on a calendar; each date becomes its own task."],
  ["as_needed", "As needed", "A standing duty the employee starts whenever it applies."],
];

/** Which selector a reported gap should open once the author dismisses the alert. */
const GAP_PANEL: Readonly<Record<VoiceDraftGap, Exclude<Panel, null> | null>> = {
  title: null,
  assignee: "users",
  due: "due",
  checklist: null,
};

/**
 * An ISO instant becomes the `datetime-local` value the due-date input needs,
 * in the viewer's own clock.
 */
function toDateTimeLocal(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * A submission in progress. Once a task is saved the requests are frozen, so a
 * retry after a partial failure creates only the remaining tasks and uploads
 * only the missing attachments; nothing saved is created twice.
 */
type Submission = Readonly<{ requests: readonly ManualTaskCreateRequest[]; taskIds: readonly string[]; uploadedTaskIds: readonly string[] }>;

function TaskSelector({ children, id, open, panel }: { children: ReactNode; id: Exclude<Panel, null>; open: boolean; panel: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  // On a phone the composer is a bottom sheet with a sticky Assign bar and,
  // often, the keyboard up: a panel opening below the fold looked like a
  // selector with nothing in it. It scrolls itself fully into view instead;
  // the bottom scroll margin keeps it clear of the sticky bar.
  useEffect(() => {
    if (open) panelRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [open]);
  // An open panel takes the whole row: squeezed into a half-width grid cell, the
  // people picker clipped its search field and names at phone width.
  return <div className={cn("min-w-0", open && "col-span-2")} data-testid={`task-selector-${id}`}>
    {children}
    {open ? <div className="mt-2 max-h-[min(26rem,50dvh)] scroll-mb-24 overflow-y-auto rounded-xl border border-task-border bg-task-muted p-3" data-testid={`task-panel-${id}`} ref={panelRef}>{panel}</div> : null}
  </div>;
}

export function TaskComposer({ canSchedule = false, canUseVoice = false, data, onClose, onCreated, onSave, onSaveSchedule, onUploadAttachment, profile }: {
  /**
   * Recurring and as-needed scheduling is offered to the roles that manage
   * schedules in Task Control; `save_recurring_todo_template_with_audit`
   * re-checks the caller.
   */
  canSchedule?: boolean;
  /** Saves one schedule template (and creates a due first occurrence); returns its id. */
  onSaveSchedule?: (payload: Json) => Promise<string>;
  /** Voice capture is offered only to authors the database grants `tasks.voice_assign`. */
  canUseVoice?: boolean;
  data: TaskReferenceData;
  onClose: () => void;
  onCreated: () => void;
  onSave: (payload: Json, doers: string[], watchers: string[], checklist: Json) => Promise<string>;
  onUploadAttachment: (taskId: string, file: File) => Promise<void>;
  profile: UserProfile;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [title, setTitle] = useState("");
  const [taskMode, setTaskMode] = useState<"task" | "checklist">("task");
  const [description, setDescription] = useState("");
  const [planned, setPlanned] = useState("");
  const [priority, setPriority] = useState<Enums<"task_priority">>("high");
  const [doers, setDoers] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] = useState<ManualTaskAssignmentMode>("separate");
  const [watchers, setWatchers] = useState<string[]>([]);
  const [formTemplateId, setFormTemplateId] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [checklistDraft, setChecklistDraft] = useState("");
  const [checklist, setChecklist] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [voiceGaps, setVoiceGaps] = useState<readonly VoiceDraftGap[]>([]);
  const [gapAlertOpen, setGapAlertOpen] = useState(false);
  const [assignmentReason, setAssignmentReason] = useState<string | null>(null);
  const [deadlineNote, setDeadlineNote] = useState<Readonly<{ text: string; resolved: boolean }> | null>(null);
  const [scheduleType, setScheduleType] = useState<ScheduleType>("once");
  const [timing, setTiming] = useState<CalendarTiming>(() => {
    const today = kolkataDateKey(new Date());
    return { type: "calendar", spec: SCHEDULE_PRESETS[0]!.spec(today), startsOn: today, keepRule: null };
  });
  // The importer's general store-hour window.
  const [startTime, setStartTime] = useState("11:00");
  const [dueTime, setDueTime] = useState("13:00");
  const [triggerLabel, setTriggerLabel] = useState("");
  const [scheduleOptions, setScheduleOptions] = useState<ScheduleOptionValues>({ verificationRequired: false, verifierId: "", followupEnabled: false, requiresRemark: false, buddy: true });
  /** People whose schedule is already saved, so a retry never creates a second one. */
  const [savedScheduleFor, setSavedScheduleFor] = useState<readonly string[] | null>(null);
  const priorityTouched = useRef(false);
  const scheduling = canSchedule && scheduleType !== "once";

  const branchNames = useMemo(() => new Map(data.branches.map((branch) => [branch.id, branch.name])), [data.branches]);
  const departmentNames = useMemo(() => new Map(data.departments.map((department) => [department.id, department.name])), [data.departments]);
  // All three enum-backed priorities, labelled from Dropdown Master.
  const priorityOptions = useMemo(() => taskPriorityChoices(data.priorities), [data.priorities]);
  // The assignment RPC resolves effective authority, overrides and scope.
  const eligiblePeople = useMemo(() => data.users.filter(user => user.id && user.tenant_id === profile.tenant_id), [data.users, profile.tenant_id]);
  const priorityLabel = priorityOptions.find((option) => option.value === priority)?.label ?? priority;
  const selectedDoers = useMemo(() => doers.flatMap((id) => eligiblePeople.filter((person) => person.id === id)), [doers, eligiblePeople]);
  // The server requires every doer of one task to share its branch and department.
  const canShare = canShareManualTask(selectedDoers.map((person) => ({ branchId: person.branch_id, departmentId: person.department_id })));
  const effectiveAssignmentMode: ManualTaskAssignmentMode = canShare ? assignmentMode : "separate";
  const doerSummary = doers.length > 1
    ? `${doers.length} users · ${effectiveAssignmentMode === "shared" ? "shared" : "separate"}`
    : selectedDoers[0]?.employee_name ?? undefined;
  const allSaved = submission !== null && submission.taskIds.length === submission.requests.length;
  const attachedForm = data.forms.find((form) => form.id === formTemplateId);

  const togglePanel = (next: Exclude<Panel, null>) => setPanel((current) => current === next ? null : next);
  const updateDoers = (nextDoers: string[]) => {
    setDoers(nextDoers);
    setWatchers((current) => current.filter((id) => !nextDoers.includes(id)));
    setAssignmentReason(null);
  };
  /**
   * Prefills the composer from an interpreted note. Only fields the note
   * actually supplied are written, so a re-record never blanks something the
   * author has already corrected by hand. The submit guards below are
   * untouched: a gap still blocks Assign.
   */
  const applyVoiceDraft = useCallback((interpretation: VoiceTaskInterpretation) => {
    const { draft } = interpretation;
    setError(null);
    if (draft.title) setTitle(draft.title);
    if (draft.description) setDescription(draft.description);
    setTaskMode(draft.taskType === "checklist" ? "checklist" : "task");
    if (draft.taskType === "checklist") {
      setChecklist([...draft.checklist]);
      setChecklistOpen(draft.checklist.length > 0);
    } else {
      // Mirrors choosing "Task" by hand, which also discards checklist items.
      setChecklist([]);
      setChecklistOpen(false);
    }
    if (draft.priority) setPriority(draft.priority);
    const nextPlanned = draft.plannedDatetime ? toDateTimeLocal(draft.plannedDatetime) : "";
    // Absent when an older function deployment answered.
    const deadline: VoiceDeadline | undefined = draft.deadline;
    // A note that named a deadline which could not be pinned to one day
    // replaces an earlier date, so a stale one is never assigned unseen.
    const spokeUnresolvedDeadline = !nextPlanned && Boolean(deadline?.dateExpression || deadline?.timeExpression);
    if (nextPlanned) setPlanned(nextPlanned);
    else if (spokeUnresolvedDeadline) setPlanned("");
    setDeadlineNote(deadline?.note ? { text: deadline.note, resolved: deadline.status === "resolved" } : null);
    const assigneeApplies = Boolean(draft.assigneeId) && eligiblePeople.some((person) => person.id === draft.assigneeId);
    if (assigneeApplies && draft.assigneeId) {
      setDoers([draft.assigneeId]);
      setWatchers((current) => current.filter((id) => id !== draft.assigneeId));
      setAssignmentReason(draft.assignmentReason);
    } else {
      setAssignmentReason(null);
    }
    // Gaps are judged on what the form will hold, not on the server's list: an
    // assignee outside this author's selectable users is dropped above and
    // must surface as "User not selected", and anything already filled by
    // hand is not a gap.
    const gaps = voiceDraftGaps({
      ...draft,
      title: draft.title || title.trim(),
      assigneeId: assigneeApplies ? draft.assigneeId : doers[0] ?? null,
      plannedDatetime: nextPlanned || (spokeUnresolvedDeadline ? "" : planned) || null,
    });
    setVoiceGaps(gaps);
    setGapAlertOpen(gaps.length > 0);
  }, [doers, eligiblePeople, planned, title]);

  const dismissGapAlert = () => {
    setGapAlertOpen(false);
    const firstPanel = voiceGaps.map((gap) => GAP_PANEL[gap]).find((target): target is Exclude<Panel, null> => target !== null);
    if (firstPanel) setPanel(firstPanel);
  };

  const addChecklistItem = () => {
    const item = checklistDraft.trim();
    if (!item) return;
    setChecklist((current) => [...current, item]);
    setChecklistDraft("");
  };

  /**
   * A schedule has one owner, so each selected person gets their own. People
   * already saved are skipped on a retry, so nothing is created twice.
   */
  const submitSchedule = async () => {
    if (!onSaveSchedule) return;
    const people = selectedDoers.flatMap((person) => person.id ? [{ id: person.id, branch_id: person.branch_id, department_id: person.department_id }] : []);
    const draft: ScheduledTaskDraft = {
      title, description, mode: taskMode, checklistItems: checklist, priority, formTemplateId, startTime, dueTime,
      timing: scheduleType === "as_needed" ? { type: "as_required", triggerLabel } : timing,
      ...scheduleOptions, active: true, personalPerformance: true,
    };
    const invalid = validateScheduledTaskDraft(draft, people);
    if (invalid) return setError(invalid);
    const saved = [...(savedScheduleFor ?? [])];
    submitting.current = true; setSaving(true);
    try {
      for (const person of people) {
        if (saved.includes(person.id)) continue;
        await onSaveSchedule(buildScheduledTaskPayload(draft, person, true) as Json);
        saved.push(person.id);
      }
      const noun = scheduleType === "as_needed" ? "duty" : "schedule";
      toast.success(people.length === 1 ? `${noun === "duty" ? "Duty" : "Schedule"} created` : `${people.length} ${noun === "duty" ? "duties" : "schedules"} created`, { description: `For ${people.length} user${people.length === 1 ? "" : "s"}. Manage ${people.length === 1 ? "it" : "them"} in Task Control → Templates.` });
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the schedule");
    } finally {
      setSavedScheduleFor(saved.length > 0 ? saved : null);
      submitting.current = false;
      setSaving(false);
    }
  };

  const chooseScheduleType = (next: ScheduleType) => {
    setScheduleType(next);
    setError(null);
    // A repeating task defaults to medium priority, as schedules always have,
    // unless the author already picked one.
    if (next !== "once" && !priorityTouched.current) setPriority("medium");
    if (next === "once" && !priorityTouched.current) setPriority("high");
    if (next !== "once") setPanel((current) => current === "due" || current === "watchers" ? null : current);
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    setError(null);
    if (scheduling) return void await submitSchedule();
    let current = submission;
    if (!current) {
      const built = buildManualTaskCreateRequests({ title, description, plannedDatetime: planned, priority, mode: taskMode, selectedDoerIds: doers, selectedWatcherIds: watchers, assignmentMode: effectiveAssignmentMode, formTemplateId, checklistItems: checklist, eligiblePeople: eligiblePeople.flatMap((person) => person.id ? [{ id: person.id, branchId: person.branch_id, departmentId: person.department_id, eligible: true }] : []) });
      if ("error" in built) return setError(built.error.message);
      current = { requests: built.requests, taskIds: [], uploadedTaskIds: [] };
    }
    const requests = current.requests;
    const taskIds = [...current.taskIds];
    const uploadedTaskIds = [...current.uploadedTaskIds];
    submitting.current = true; setSaving(true);
    try {
      for (const request of requests.slice(taskIds.length)) {
        taskIds.push(await onSave(request.payload, [...request.doerIds], [...request.watcherIds], [...request.checklist]));
      }
      if (attachment) {
        for (const taskId of taskIds) {
          if (uploadedTaskIds.includes(taskId)) continue;
          await onUploadAttachment(taskId, attachment);
          uploadedTaskIds.push(taskId);
        }
      }
      const doerCount = requests.reduce((count, request) => count + request.doerIds.length, 0);
      toast.success(requests.length === 1 ? "Task assigned" : `${requests.length} tasks assigned`, { description: `Sent to ${doerCount} user${doerCount === 1 ? "" : "s"}.` });
      onCreated();
    } catch (caught) {
      const fallback = taskIds.length < requests.length ? "Unable to create task" : "The attachment could not be uploaded. Try again.";
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      // Nothing saved yet leaves the composer editable; anything saved freezes it.
      setSubmission(taskIds.length > 0 ? { requests, taskIds, uploadedTaskIds } : null);
      submitting.current = false;
      setSaving(false);
    }
  };

  /** Gaps the author has not filled yet, so the warning clears as they work. */
  const outstandingVoiceGaps = useMemo(() => voiceGaps.filter((gap) => gap === "title"
    ? !title.trim()
    : gap === "assignee"
      ? doers.length === 0
      : gap === "due"
        ? !planned
        : checklist.length === 0), [checklist.length, doers.length, planned, title, voiceGaps]);

  const assignmentChoice = (mode: ManualTaskAssignmentMode, label: string, hint: string, disabled = false) => <label className={cn("flex min-h-11 items-start gap-3 rounded-lg border px-3 py-2 text-sm", effectiveAssignmentMode === mode ? "border-task-accent bg-task-accent-soft" : "border-task-border bg-task-bg", disabled && "opacity-60")}><input checked={effectiveAssignmentMode === mode} className="mt-0.5 size-4 accent-task-accent" disabled={disabled} name="task-assignment-mode" onChange={() => setAssignmentMode(mode)} type="radio" /><span className="min-w-0"><span className="block font-medium text-task-text">{label}</span><span className="block text-xs text-task-text-muted">{hint}</span></span></label>;
  const usersPanel = <div className="space-y-3">
    <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="Assign users" multiple onChange={updateDoers} people={eligiblePeople.flatMap((person) => person.id ? [{ ...person, id: person.id }] : [])} selectedIds={doers} />
    {scheduling && doers.length > 1 ? <p className="text-xs text-task-text-muted" data-testid="schedule-separate-note">Each selected user gets their own {scheduleType === "as_needed" ? "duty" : "schedule"}. A shared schedule is not available: a schedule has one owner.</p> : null}
    {!scheduling && doers.length > 1 ? <fieldset className="space-y-2" data-testid="task-assignment-mode"><legend className="mb-1 text-xs font-semibold text-task-text">How should {doers.length} users get this task?</legend>
      {assignmentChoice("separate", "Separate task for each user", "Everyone gets their own copy and completes it themselves.")}
      {assignmentChoice("shared", "One shared task", canShare ? "Any one of them can complete it for everyone." : "Needs every user in the same branch and department.", !canShare)}
    </fieldset> : null}
  </div>;
  const duePanel = <label><span className="mb-1 block text-xs font-semibold text-task-text">Due date and time</span><input className="task-field" min={new Date().toISOString().slice(0, 16)} onChange={(event) => { setPlanned(event.target.value); setDeadlineNote(null); setPanel(null); }} type="datetime-local" value={planned} /></label>;
  const priorityPanel = <fieldset className="grid grid-cols-3 gap-2"><legend className="sr-only">Priority</legend>{priorityOptions.map((option) => <button aria-pressed={priority === option.value} className={cn("min-h-11 min-w-0 rounded-lg border px-2 text-sm", priority === option.value ? "border-task-accent bg-task-accent-soft font-semibold text-task-text" : "border-task-border bg-task-bg text-task-text-muted")} key={option.value} onClick={() => { priorityTouched.current = true; setPriority(option.value); setPanel(null); }} type="button">{priority === option.value ? <Check className="mr-1 inline size-4" /> : null}{option.label}</button>)}</fieldset>;
  const formPanel = <div><label><span className="mb-1 block text-xs font-semibold text-task-text">Required form</span><select className="task-field" onChange={(event) => { setFormTemplateId(event.target.value); setPanel(null); }} value={formTemplateId}><option value="">No form required</option>{data.forms.filter((form) => form.lifecycle === "published").map((form) => <option key={form.id} value={form.id}>{form.name} v{form.version}</option>)}</select></label><p className="mt-2 text-xs text-task-text-muted">The selected form must be completed before this task can be finished.</p></div>;
  const watchersPanel = <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} disabledIds={doers} label="In Loop · view and comment" multiple onChange={setWatchers} people={eligiblePeople.flatMap((person) => person.id ? [{ ...person, id: person.id }] : [])} selectedIds={watchers} />;

  return (
    <Modal onClose={submission ? onCreated : onClose} title="Assign New Task" tone="light" wide>
      {error ? <div className="mb-4"><Notice tone="danger">{error}</Notice></div> : null}
      {submission ? <div className="mb-4"><Notice>{allSaved
        ? submission.requests.length === 1 ? "The task is saved. Retry uploads against this task; its assignment details are already committed." : `All ${submission.requests.length} tasks are saved. Retry uploads against them; their assignment details are already committed.`
        : `${submission.taskIds.length} of ${submission.requests.length} tasks are saved. Assign again to create the rest; saved tasks are not created twice.`}</Notice></div> : null}
      {savedScheduleFor ? <div className="mb-4"><Notice>{`${savedScheduleFor.length} of ${doers.length} schedules are saved. Press Create again to save the rest; saved schedules are not created twice.`}</Notice></div> : null}

      {canUseVoice && !submission ? <VoiceTaskCapture onInterpreted={applyVoiceDraft} /> : null}

      {gapAlertOpen ? <div className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-4" data-testid="voice-gap-alert" role="alertdialog" aria-labelledby="voice-gap-alert-title">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-danger" id="voice-gap-alert-title">Finish these before assigning</h3>
            <ul className="mt-1 space-y-0.5 text-sm text-task-text">{voiceGaps.map((gap) => <li key={gap}>{voiceDraftGapMessage(gap)}</li>)}</ul>
          </div>
        </div>
        <Button autoFocus className="mt-3 border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={dismissGapAlert} type="button" variant="secondary">Fill them in</Button>
      </div> : null}

      {!gapAlertOpen && outstandingVoiceGaps.length > 0 ? <div className="mb-4" data-testid="voice-gap-notice"><Notice tone="danger">Still missing: {outstandingVoiceGaps.map(voiceDraftGapMessage).join(" ")}</Notice></div> : null}

      {assignmentReason ? <p className="mb-3 text-xs text-task-text-muted" data-testid="voice-assignment-reason">Assigned from your voice note · {assignmentReason}</p> : null}
      {deadlineNote ? <p className={cn("mb-3 text-xs", deadlineNote.resolved ? "text-task-text-muted" : "text-danger")} data-testid="voice-deadline-note">Deadline from your voice note · {deadlineNote.text}</p> : null}

      <form className="flex flex-col" onSubmit={(event) => void submitManual(event)}>
        <fieldset className="min-w-0" disabled={saving || submission !== null || savedScheduleFor !== null}>
          <label className="border-b border-task-border px-1 pb-3">
            <span className="sr-only">Task title</span>
            <input autoFocus className="w-full bg-transparent text-base font-medium text-task-text placeholder:text-task-text-muted/80 focus-visible:ring-0" data-autofocus maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Add Title" value={title} />
          </label>
          <label className="border-b border-task-border px-1 py-3">
            <span className="sr-only">Task description</span>
            <textarea className="min-h-24 w-full resize-y rounded-xl bg-task-muted p-3 text-base md:text-sm text-task-text placeholder:text-task-text-muted focus-visible:ring-task-accent" onChange={(event) => setDescription(event.target.value)} placeholder="Add Description" value={description} />
          </label>
          <fieldset className="border-b border-task-border py-3"><legend className="mb-2 text-sm font-semibold text-task-text">Task type</legend><div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2"><button aria-pressed={taskMode === "task"} className={cn("min-h-11 rounded-lg border px-3 text-sm", taskMode === "task" ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text-muted")} onClick={() => { setTaskMode("task"); setChecklist([]); setChecklistOpen(false); }} type="button">Task — upload to complete</button><button aria-pressed={taskMode === "checklist"} className={cn("min-h-11 rounded-lg border px-3 text-sm", taskMode === "checklist" ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text-muted")} onClick={() => setTaskMode("checklist")} type="button">Checklist — tick every item</button></div></fieldset>
          {taskMode === "checklist" ? <section className="border-b border-task-border py-3">
            <button aria-expanded={checklistOpen} className="flex min-h-11 w-full items-center justify-between text-sm font-semibold text-task-text" onClick={() => setChecklistOpen((current) => !current)} type="button"><span className="flex items-center gap-2"><Plus className="size-4" />Add Checklist</span><ChevronDown className={cn("size-4 transition-transform", checklistOpen ? "rotate-180" : "")} /></button>
            {checklistOpen ? <div className="mt-2 space-y-2"><input className="task-field" onChange={(event) => setChecklistDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addChecklistItem(); } }} placeholder="Type and hit Enter" value={checklistDraft} />{checklist.map((item, index) => <div className="flex items-center gap-3 rounded-xl border border-task-border bg-task-muted px-3 py-2 text-sm text-task-text" key={`${item}-${index}`}><input aria-label={`Required checklist item ${index + 1}`} checked readOnly type="checkbox" /><span className="min-w-0 flex-1 truncate">{item}</span><button aria-label={`Remove checklist item ${index + 1}`} className="text-task-text-muted hover:text-task-text" onClick={() => setChecklist((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button"><X className="size-4" /></button></div>)}</div> : null}
          </section> : null}

          {canSchedule ? <fieldset className="border-b border-task-border py-3" data-testid="task-schedule-type">
            <legend className="mb-2 text-sm font-semibold text-task-text">Schedule</legend>
            <div className="grid grid-cols-3 gap-2">{SCHEDULE_TYPES.map(([value, label]) => <button aria-pressed={scheduleType === value} className={cn("min-h-11 rounded-lg border px-2 text-sm", scheduleType === value ? "border-task-accent bg-task-accent-soft font-semibold text-task-text" : "border-task-border text-task-text-muted")} key={value} onClick={() => chooseScheduleType(value)} type="button">{label}</button>)}</div>
            <p className="mt-2 text-xs text-task-text-muted">{SCHEDULE_TYPES.find(([value]) => value === scheduleType)?.[2]}</p>
          </fieldset> : null}

          {scheduling && scheduleType === "recurring" ? <section aria-label="Recurring schedule" className="border-b border-task-border py-3">
            <ScheduleFields assigneeNames={selectedDoers.map((person) => person.employee_name ?? "")} dueTime={dueTime} isNew onDueTime={setDueTime} onStartTime={setStartTime} onTiming={setTiming} onUseCheckpoints={(labels) => { setTaskMode("checklist"); setChecklist(labels.map((label) => `${label}: ${title.trim() || "Task"}`)); setChecklistOpen(true); }} startTime={startTime} timing={timing} />
          </section> : null}

          {scheduling && scheduleType === "as_needed" ? <section aria-label="As-needed duty" className="space-y-2 border-b border-task-border py-3">
            <label className="block"><span className="mb-1 block text-xs font-semibold text-task-text">When does it apply?</span>
              <input className="task-field" list="as-needed-triggers" maxLength={80} onChange={(event) => setTriggerLabel(event.target.value)} placeholder="As Required, Per Customer, After Visit…" value={triggerLabel} />
              <datalist id="as-needed-triggers">{AS_NEEDED_TRIGGER_SUGGESTIONS.map((label) => <option key={label} value={label} />)}</datalist>
            </label>
            <p className="text-xs text-task-text-muted">Nothing is created on a calendar. The employee sees it every day under “Anytime duties” and presses Start (low priority) each time it applies; a manager can press “Assign now” in Task Control to give it as high priority.</p>
          </section> : null}

          {scheduling ? <details className="border-b border-task-border py-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-task-text">More options</summary>
            <div className="mt-2"><ScheduleOptions onChange={setScheduleOptions} people={eligiblePeople} values={scheduleOptions} /></div>
          </details> : null}

          <div className="grid grid-cols-2 gap-2 border-b border-task-border py-3">
            <TaskSelector id="users" open={panel === "users"} panel={usersPanel}><ChipSelector active={panel === "users"} Icon={Users} label="Users" onClick={() => togglePanel("users")} summary={doerSummary || undefined} /></TaskSelector>
            {!scheduling ? <TaskSelector id="due" open={panel === "due"} panel={duePanel}><ChipSelector active={panel === "due"} Icon={CalendarDays} label="Due Date" onClick={() => togglePanel("due")} summary={planned ? new Date(planned).toLocaleString("en-IN", { day: "numeric", hour: "numeric", minute: "2-digit", month: "short" }) : undefined} /></TaskSelector> : null}
            <TaskSelector id="priority" open={panel === "priority"} panel={priorityPanel}><ChipSelector active={panel === "priority"} Icon={Flag} label="Priority" onClick={() => togglePanel("priority")} summary={priorityLabel} /></TaskSelector>
            <TaskSelector id="form" open={panel === "form"} panel={formPanel}><ChipSelector active={panel === "form"} Icon={FileText} label="Attach Form" onClick={() => togglePanel("form")} summary={attachedForm?.name} /></TaskSelector>
            {!scheduling ? <TaskSelector id="watchers" open={panel === "watchers"} panel={watchersPanel}><ChipSelector active={panel === "watchers"} Icon={UserRoundCheck} label="In Loop" onClick={() => togglePanel("watchers")} summary={watchers.length ? `${watchers.length} in loop` : undefined} /></TaskSelector> : null}
          </div>
          {scheduling ? <p className="pt-2 text-xs text-task-text-muted" data-testid="schedule-unsupported-note">In Loop and file attachments are for one-time tasks only; schedules do not carry them.</p> : null}


        </fieldset>
          <div className="sticky -bottom-5 -mx-5 mt-4 flex items-center gap-3 border-t border-task-border bg-task-bg px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {!scheduling ? <label className="flex size-11 cursor-pointer items-center justify-center rounded-lg text-task-text-muted hover:bg-task-muted"><Paperclip className="size-5" /><span className="sr-only">Attach image or document</span><input accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={saving} onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} type="file" /></label> : null}
            {attachment && !scheduling ? <Button aria-label="Remove attachment" className="size-11 shrink-0 p-0" disabled={saving} onClick={() => setAttachment(null)} type="button" variant="ghost"><X /></Button> : null}
            {scheduling
              ? <Button className="ml-auto bg-task-accent text-task-text hover:bg-task-accent/90" disabled={saving} type="submit"><Rocket />{saving ? "Saving…" : savedScheduleFor ? "Create remaining" : scheduleType === "as_needed" ? "Create duty" : "Create schedule"}</Button>
              : <Button className="ml-auto bg-task-accent text-task-text hover:bg-task-accent/90" disabled={saving} type="submit"><Rocket />{saving ? allSaved ? "Uploading…" : "Assigning…" : allSaved ? attachment ? "Retry attachment" : "Finish without attachment" : submission ? "Assign remaining" : "Assign Task"}</Button>}
          </div>
      </form>
    </Modal>
  );
}
