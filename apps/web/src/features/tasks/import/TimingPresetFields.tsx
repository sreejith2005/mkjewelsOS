import type { TaskImportTimingPresetKey, TaskImportTimingPresets } from "@jewelos/core";

const LABELS: Readonly<Record<TaskImportTimingPresetKey, string>> = {
  general: "General",
  opening: "Opening",
  morning: "Morning",
  closing: "Closing",
  evening: "Evening",
  manual: "Manual Run Now",
};
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function taskImportTimingWindowsValid(required: readonly TaskImportTimingPresetKey[], value: TaskImportTimingPresets) {
  return required.every((key) => {
    const window = value[key];
    return Boolean(window && TIME.test(window.startTime) && TIME.test(window.dueTime) && window.dueTime > window.startTime);
  });
}

export function TimingPresetFields({
  disabled,
  onChange,
  required,
  value,
}: Readonly<{
  disabled: boolean;
  onChange: (next: TaskImportTimingPresets) => void;
  required: readonly TaskImportTimingPresetKey[];
  value: TaskImportTimingPresets;
}>) {
  if (!required.length) return null;
  const update = (key: TaskImportTimingPresetKey, field: "startTime" | "dueTime", next: string) => {
    onChange({
      ...value,
      [key]: { startTime: value[key]?.startTime ?? "", dueTime: value[key]?.dueTime ?? "", [field]: next },
    });
  };

  return <div className="rounded-xl border border-task-border bg-task-bg p-4">
    <h2 className="font-semibold">Times needed for blank sheet cells</h2>
    <p className="mt-1 text-sm text-task-text-muted">These times apply only where the uploaded row leaves its time blank.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {required.map((key) => {
        const window = value[key] ?? { startTime: "", dueTime: "" };
        const startInvalid = !TIME.test(window.startTime);
        const dueInvalid = !TIME.test(window.dueTime) || (!startInvalid && window.dueTime <= window.startTime);
        return <fieldset className="rounded-lg border border-task-border p-3" disabled={disabled} key={key}>
          <legend className="px-1 text-sm font-medium">{LABELS[key]}</legend>
          <div className="grid grid-cols-2 gap-2">
            <label><span className="label">{LABELS[key]} start time</span><input aria-invalid={startInvalid} className="task-field mt-1" onChange={(event) => update(key, "startTime", event.target.value)} type="time" value={window.startTime}/></label>
            <label><span className="label">{LABELS[key]} due time</span><input aria-invalid={dueInvalid} className="task-field mt-1" onChange={(event) => update(key, "dueTime", event.target.value)} type="time" value={window.dueTime}/></label>
          </div>
          {startInvalid || dueInvalid ? <p className="mt-2 text-xs text-danger" role="alert">Enter both times, with due time later than start time.</p> : null}
        </fieldset>;
      })}
    </div>
  </div>;
}
