export type FormUsageImpact = {
  form: { id: string; name: string; version: number; lifecycle: string };
  flows: Array<{ id: string; name: string; version: number; status: string; stages: string[] | null; activeInstances: number }>;
  taskTemplates: Array<{ id: string; title: string; active: boolean }>;
  tasks: Array<{ id: string; title: string; status: string }>;
  starterAssignments: Array<{ id: string; flowName: string; status: string }>;
  submissions: number;
};

export function describePublishedFormEdit(impact: FormUsageImpact): string {
  const starterFlows = new Map<string, number>();
  for (const assignment of impact.starterAssignments) {
    starterFlows.set(assignment.flowName, (starterFlows.get(assignment.flowName) ?? 0) + 1);
  }
  const lines = [
    `Edit ${impact.form.name} v${impact.form.version} under the same form ID?`,
    "Connected FMS stages:",
    ...impact.flows.flatMap((flow) => (flow.stages ?? []).map((stage) =>
      `• ${flow.name} v${flow.version} / ${stage} (${flow.activeInstances} active runs)`)),
    "Connected task templates:",
    ...impact.taskTemplates.map((task) => `• ${task.title}${task.active ? "" : " (inactive)"}`),
    "Open tasks:",
    ...impact.tasks.map((task) => `• ${task.title} (${task.status})`),
    "Pending FMS starter assignments:",
    ...[...starterFlows].map(([flowName, count]) => `• ${flowName}: ${count} pending starter assignment${count === 1 ? "" : "s"}`),
    `${impact.submissions} completed submissions retain their original questions.`,
    "Saving here changes the questions shown to future submissions and open work that uses this ID. Changing question keys or answer choices can break FMS answer routes or answers already in progress.",
    "Create a new version to keep old work on its current form, then select the new version in connected tasks and FMS stages.",
    "Save changes to this published form anyway?",
  ];
  return lines.join("\n");
}
