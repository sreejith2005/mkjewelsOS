import type { FmsAiCatalog, FmsDiagnosticCatalog } from "@jewelos/core";
import type { FmsData } from "../api";

/** Employees who can receive work: the same rule the Default assignees picker uses. */
export function fmsAiUserIsActive(user: FmsData["users"][number]): boolean {
  return user.working_status === "active" && user.account_status !== "inactive" && user.account_status !== "suspended";
}

/** The builder's already-loaded, RLS-scoped data, in the shape the core compiler checks against. */
export function fmsAiCatalogFromData(data: FmsData): FmsAiCatalog {
  return {
    forms: data.forms.map((form) => ({ id: form.id, name: form.name, version: form.version, lifecycle: form.lifecycle })),
    formFields: data.formFields,
    users: data.users.map((user) => ({ id: user.id, name: user.employee_name, active: fmsAiUserIsActive(user), loginEnabled: user.is_login_enabled === true })),
  };
}

export function fmsDiagnosticCatalogFromData(data: FmsData): FmsDiagnosticCatalog {
  const today = new Map(data.availability.map((row) => [row.user_profile_id, row.status]));
  return {
    forms: data.forms.map((form) => ({ id: form.id, name: form.name, version: form.version, familyId: form.family_id, lifecycle: form.lifecycle })),
    formFields: data.formFields,
    users: data.users.map((user) => ({ id: user.id, name: user.employee_name, active: fmsAiUserIsActive(user), loginEnabled: user.is_login_enabled === true, availability: today.get(user.id) })),
  };
}
