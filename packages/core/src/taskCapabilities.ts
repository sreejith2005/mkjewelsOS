import type { UserRole } from "./roleMenu";

export type TaskMutationCapability = Readonly<{
  access: "doer" | "elevated" | "read_only";
  canMutate: boolean;
  canUseElevatedActions: boolean;
  watcherLabel: string | null;
}>;

const ELEVATED_TASK_ROLES = new Set<UserRole>(["super_admin", "admin", "manager"]);

const ELEVATED_ACCESS_LABELS: Readonly<Partial<Record<UserRole, string>>> = {
  super_admin: "super admin",
  admin: "admin",
  manager: "manager",
};

export function deriveTaskMutationCapability({
  assigneeIds,
  isWatcher,
  viewerId,
  viewerRole,
}: Readonly<{
  assigneeIds: readonly string[];
  isWatcher: boolean;
  viewerId: string;
  viewerRole: UserRole;
}>): TaskMutationCapability {
  const canUseElevatedActions = ELEVATED_TASK_ROLES.has(viewerRole);
  const isActiveDoer = assigneeIds.includes(viewerId);
  const access = canUseElevatedActions ? "elevated" : isActiveDoer ? "doer" : "read_only";

  return {
    access,
    canMutate: access !== "read_only",
    canUseElevatedActions,
    watcherLabel: !isWatcher
      ? null
      : canUseElevatedActions
        ? `Watching · ${ELEVATED_ACCESS_LABELS[viewerRole]} access`
        : "Watching · read only",
  };
}
