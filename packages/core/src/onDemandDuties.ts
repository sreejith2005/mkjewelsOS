/**
 * On-demand duties: assigned `as_required` templates (As Required, Per Customer,
 * After Visit, ...). They have no calendar date; the employee starts an
 * occurrence when the event happens, or a manager assigns one now. The database
 * (`get_my_on_demand_duties`, `start_on_demand_task_with_audit`) is the source
 * of truth; this module only parses and labels its answers.
 */

export type OnDemandDuty = Readonly<{
  templateId: string;
  title: string;
  description: string | null;
  triggerLabel: string;
  taskType: "checklist" | "delegation";
  priority: string;
  dueTime: string | null;
  requiresUpload: boolean;
  startedToday: number;
  openCount: number;
}>;

/** Shown when an imported duty has no sheet wording (older imports). */
export const ON_DEMAND_FALLBACK_TRIGGER = "As needed";

export function isOnDemandSchedule(template: Readonly<{ schedule_kind?: string | null }>): boolean {
  return template.schedule_kind === "as_required";
}

export function onDemandTriggerLabel(label: string | null | undefined): string {
  const trimmed = label?.trim();
  return trimmed ? trimmed : ON_DEMAND_FALLBACK_TRIGGER;
}

/** "Done 2 today · 1 open", or "Not started today". */
export function onDemandDutyProgress(duty: Pick<OnDemandDuty, "startedToday" | "openCount">): string {
  if (duty.startedToday === 0 && duty.openCount === 0) return "Not started today";
  const parts = [`Done ${duty.startedToday} today`];
  if (duty.openCount > 0) parts.push(`${duty.openCount} open`);
  return parts.join(" · ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseOnDemandDuties(value: unknown): OnDemandDuty[] {
  if (!isRecord(value) || !Array.isArray(value.duties)) throw new Error("On-demand duties response is invalid");
  return value.duties.flatMap((row): OnDemandDuty[] => {
    if (!isRecord(row)) return [];
    const templateId = text(row.template_id);
    const title = text(row.title);
    if (!templateId || !title) return [];
    return [{
      templateId,
      title,
      description: text(row.description),
      triggerLabel: onDemandTriggerLabel(text(row.trigger_label)),
      taskType: row.task_type === "checklist" ? "checklist" : "delegation",
      priority: text(row.priority) ?? "medium",
      dueTime: text(row.due_time),
      requiresUpload: row.requires_upload === true,
      startedToday: count(row.started_today),
      openCount: count(row.open_count),
    }];
  });
}
