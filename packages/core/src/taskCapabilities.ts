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

/** Review authority is separate from permission to perform the assigned work. */
export function canReviewTask(task: Readonly<{
  task_type: string | null; status: string | null; verification_status: string | null;
  isWatchedByViewer: boolean; verifier_user_profile_id: string | null;
}>, viewerId: string | undefined): boolean {
  return Boolean(viewerId) && (task.task_type === "delegation" || task.task_type === "checklist")
    && task.status === "completed" && (task.verification_status === "pending" || task.verification_status === "rejected")
    && (task.isWatchedByViewer || task.verifier_user_profile_id === viewerId);
}
