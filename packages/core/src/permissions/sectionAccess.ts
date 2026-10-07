import { isImplementedPage, type UserRole } from "../roleMenu";
import { PERMISSION_CATALOG, type PermissionKey } from "./catalog";
import type { PermissionEffect, PermissionOverrides } from "./resolve";

export const SECTION_PERMISSIONS = PERMISSION_CATALOG.filter(item => item.kind === "module" && item.pageId !== null && isImplementedPage(item.pageId));
export const SECTION_ACCESS_OPTIONS = [
  { value: "inherit", label: "Inherit" },
  { value: "grant", label: "Enable" },
  { value: "deny", label: "Disable" },
] as const;
export type SectionAccessChoice = "inherit" | PermissionEffect;
export type SectionAccessDraft = Partial<Record<PermissionKey, PermissionEffect | null>>;
export type SectionAccessRow = Readonly<{
  key: PermissionKey; roleDefault: boolean; department: PermissionEffect | null;
  designation: PermissionEffect | null; user: PermissionEffect | null; effective: boolean;
}>;

export function previewSectionAccess(row: SectionAccessRow, pending: PermissionEffect | null | undefined, effectiveRole: UserRole): Readonly<{ effective: boolean; source: string }> {
  if (effectiveRole === "super_admin") return { effective: true, source: "Super Admin" };
  const individual = pending === undefined ? row.user : pending;
  const effect = individual ?? row.department ?? row.designation;
  return { effective: effect ? effect === "grant" : row.roleDefault, source: individual ? "Individual" : row.department ? "Department" : row.designation ? "Designation" : "Role" };
}

export function sectionOverrideChanges(saved: PermissionOverrides, draft: SectionAccessDraft): SectionAccessDraft {
  const changes: SectionAccessDraft = {};
  for (const item of SECTION_PERMISSIONS) {
    const pending = draft[item.key];
    if (pending !== undefined && pending !== (saved[item.key] ?? null)) changes[item.key] = pending;
  }
  return changes;
}
