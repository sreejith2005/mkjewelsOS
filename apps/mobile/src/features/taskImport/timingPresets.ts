import type { TaskImportTimingPresetKey, TaskImportTimingPresets } from "@jewelos/core";

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function updateTaskImportTimingPreset(
  value: TaskImportTimingPresets,
  key: TaskImportTimingPresetKey,
  field: "startTime" | "dueTime",
  next: string,
): TaskImportTimingPresets {
  return {
    ...value,
    [key]: {
      startTime: value[key]?.startTime ?? "",
      dueTime: value[key]?.dueTime ?? "",
      [field]: next,
    },
  };
}

export function taskImportTimingWindowsValid(required: readonly TaskImportTimingPresetKey[], value: TaskImportTimingPresets) {
  return required.every((key) => {
    const window = value[key];
    return Boolean(window && TIME.test(window.startTime) && TIME.test(window.dueTime) && window.dueTime > window.startTime);
  });
}
