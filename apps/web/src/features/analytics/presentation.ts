import type { UserRole } from "@jewelos/core";

export type AsyncPresentation = "loading" | "error" | "empty" | "ready";
export type ExportStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "expired";

export function asyncPresentation(loading: boolean, error: string | null, rowCount: number): AsyncPresentation {
  if (loading) return "loading";
  if (error) return "error";
  return rowCount === 0 ? "empty" : "ready";
}

export function homeSectionsForRole(role: UserRole): readonly string[] {
  const sections = ["tasks", "fms", "forms", "notifications", "availability", "activity"];
  return ["super_admin", "admin", "manager", "crm"].includes(role) ? [...sections, "crm_followups"] : sections;
}

export function dashboardSectionsForRole(role: UserRole): readonly string[] {
  const sections = ["personal_tasks", "fms", "forms", "notifications"];
  if (["super_admin", "admin", "manager", "crm"].includes(role)) sections.push("crm");
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
