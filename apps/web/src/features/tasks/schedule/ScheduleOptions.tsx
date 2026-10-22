import type { ReactNode } from "react";

export type ScheduleOptionValues = Readonly<{
  verificationRequired: boolean;
  verifierId: string;
  followupEnabled: boolean;
  requiresRemark: boolean;
  buddy: boolean;
}>;

function Check({ checked, onChange, title, hint }: { checked: boolean; onChange: (value: boolean) => void; title: string; hint: ReactNode }) {
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-lg border border-task-border bg-task-bg px-3 py-2 text-sm">
      <input checked={checked} className="mt-0.5 size-4 accent-task-accent" onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span className="min-w-0">
        <span className="block font-medium text-task-text">{title}</span>
        <span className="block text-xs text-task-text-muted">{hint}</span>
      </span>
    </label>
  );
}

/**
 * The review and completion rules a schedule can carry beyond what a one-time
 * task has. Each maps to one `task_templates` column the save RPC already
 * validates (`verification_required` with an active verifier,
 * `followup_enabled`, `buddy_assignment_allowed`). `requiresRemark` stays
 * false: tasks no longer ask for a completion remark (migration 0342).
 */
export function ScheduleOptions({
  values,
  onChange,
  people,
}: {
  values: ScheduleOptionValues;
  onChange: (next: ScheduleOptionValues) => void;
  people: ReadonlyArray<{ id: string | null; employee_name: string | null }>;
}) {
  const set = (patch: Partial<ScheduleOptionValues>) => onChange({ ...values, ...patch });
  const verifierMissing = values.verificationRequired && !values.verifierId;
  return (
    <div className="space-y-2" data-testid="schedule-options">
      <Check
        checked={values.verificationRequired}
        hint="Completed occurrences wait in Task Control → Review until verified or rejected."
        onChange={(verificationRequired) => set({ verificationRequired, verifierId: verificationRequired ? values.verifierId : "" })}
        title="Verify completed work"
      />
      {values.verificationRequired ? (
        <label className="block pl-1">
          <span className="mb-1 block text-xs font-semibold text-task-text">Verifier</span>
          <select aria-invalid={verifierMissing} className="task-field" onChange={(event) => set({ verifierId: event.target.value })} value={values.verifierId}>
            <option value="">Choose who verifies</option>
            {people.map((person) => (person.id ? <option key={person.id} value={person.id}>{person.employee_name}</option> : null))}
          </select>
          {verifierMissing ? <span className="mt-1 block text-xs text-danger" role="alert">Choose who verifies the completed work.</span> : null}
        </label>
      ) : null}
      <Check checked={values.followupEnabled} hint="Admins can send reminders on open occurrences from Task Control → Review." onChange={(followupEnabled) => set({ followupEnabled })} title="Allow follow-ups" />
      <Check checked={values.buddy} hint="If the doer is on leave or a week-off, the buddy gets that day's occurrence." onChange={(buddy) => set({ buddy })} title="Buddy can cover" />
    </div>
  );
}
