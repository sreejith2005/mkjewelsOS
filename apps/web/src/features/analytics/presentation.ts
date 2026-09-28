import type { UserRole } from "@jewelos/core";

export type AsyncPresentation = "loading" | "error" | "empty" | "ready";
export type ExportStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "expired";

export function asyncPresentation(loading: boolean, error: string | null, rowCount: number): AsyncPresentation {
  if (loading) return "loading";
  if (error) return "error";
  return rowCount === 0 ? "empty" : "ready";
}

// The old JewelOS CRM follow-ups (Home) and CRM metrics (dashboard) read the archived public CRM
// tables and are hidden for every role since the CRM cutover.
export function homeSectionsForRole(_role: UserRole): readonly string[] {
  return ["tasks", "fms", "forms", "notifications", "availability", "activity"];
}

export function dashboardSectionsForRole(role: UserRole): readonly string[] {
  const sections = ["personal_tasks", "fms", "forms", "notifications"];
  if (["super_admin", "admin", "manager", "hr"].includes(role)) sections.push("people");
  if (["super_admin", "admin"].includes(role)) sections.push("delivery_health");
  return sections;
}

export function settingsSectionsForRole(role: UserRole): readonly string[] {
  if (["super_admin", "admin"].includes(role)) return ["account", "preferences", "tenant", "branch", "session"];
  if (role === "manager") return ["account", "preferences", "branch", "session"];
  return ["account", "preferences", "session"];
}

export function exportActionsForStatus(status: ExportStatus): readonly string[] {
  if (status === "completed") return ["download"];
  if (status === "queued" || status === "processing") return ["cancel"];
  if (status === "failed" || status === "expired") return ["retry"];
  return [];
}

export function reportSearch(report: string, filters: Readonly<Record<string, string | number | undefined>>): string {
  const params = new URLSearchParams({ report });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value));
  return `?${params.toString()}`;
}
