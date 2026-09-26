import type { UserRole } from "./roleMenu";

export type TaskMutationCapability = Readonly<{
  access: "doer" | "watcher" | "elevated" | "read_only";
  canMutate: boolean;
  canUseElevatedActions: boolean;
  watcherLabel: string | null;
}>;

const ELEVATED_TASK_ROLES = new Set<UserRole>(["super_admin", "admin", "manager"]);

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
  const isActiveDoer = assigneeIds.includes(viewerId);
  const watcherOnly = isWatcher && !isActiveDoer;
  const canUseElevatedActions = ELEVATED_TASK_ROLES.has(viewerRole) && !watcherOnly;
  const access = watcherOnly ? "watcher" : canUseElevatedActions ? "elevated" : isActiveDoer ? "doer" : "read_only";

  return {
    access,
    canMutate: access === "doer" || access === "elevated",
    canUseElevatedActions,
    watcherLabel: isWatcher ? "In Loop" : null,
  };
}
