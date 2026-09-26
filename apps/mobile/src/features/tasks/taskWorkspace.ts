import { kolkataDateKey, splitAssignedTaskFeed, splitWatchedTaskFeed } from "@jewelos/core";
import type { UserProfile } from "@jewelos/data/auth/session";
import { ensureMyRecurringTasks, loadTaskFeed, loadTaskFeedReferenceData, type TaskBundle, type TaskFeedReferenceData } from "@jewelos/data/tasks/api";
import { log } from "@/lib/log";

const MANAGER_ROLES = new Set(["super_admin", "admin", "manager"]);
const ADMIN_TASK_VIEW_ROLES = new Set(["super_admin", "admin"]);

export type TaskWorkspace = Readonly<{
  mine: TaskBundle[];
  delegated: TaskBundle[];
  inLoop: TaskBundle[];
  categories: TaskFeedReferenceData["categories"];
}>;

type WorkspaceViewer = Pick<UserProfile, "id" | "tenant_id" | "user_role">;

/** Managers see coverage-blocked work in their own feed, as on the web Tasks page. */
export function canManageTaskWorkspace(viewer: Pick<UserProfile, "user_role">): boolean {
  return MANAGER_ROLES.has(viewer.user_role);
}

/** Administrators get a separate Delegated feed of the work they authored. */
export function hasAdminTaskView(viewer: Pick<UserProfile, "user_role">): boolean {
  return ADMIN_TASK_VIEW_ROLES.has(viewer.user_role);
}

/**
 * The web Tasks page's two feeds, loaded the same way: the viewer's assigned
 * feed (with coverage-blocked work for managers) and, for administrators, the
 * feed of work they delegated. The Tasks list and Task detail both read this,
 * so a task that is listed can always be opened.
 */
export async function loadTaskWorkspace(viewer: WorkspaceViewer, options: Readonly<{ prepareRecurring?: boolean }> = {}): Promise<TaskWorkspace> {
  const today = kolkataDateKey(new Date());
  const start = `${today}T00:00:00.000+05:30`;
  const end = `${today}T23:59:59.999+05:30`;
  const manager = canManageTaskWorkspace(viewer);
  const admin = hasAdminTaskView(viewer);
  if (options.prepareRecurring) {
    // Recurring occurrences are generated on demand. If that call fails the
    // feed is still worth showing, so it never blocks the list.
    await ensureMyRecurringTasks().catch((error: unknown) => {
      log.warn("api", "could not prepare recurring tasks; showing the feed as it stands");
      log.debug("api", "recurring preparation error", error);
    });
  }
  const [assigned, authored, references] = await Promise.all([
    loadTaskFeed(viewer.id, start, end, { tenantId: viewer.tenant_id, includeBlockedCoverage: manager, includeOverdue: true }),
    admin
      ? loadTaskFeed(viewer.id, start, end, { tenantId: viewer.tenant_id, delegated: true, includeOverdue: true })
      : Promise.resolve<TaskBundle[]>([]),
    loadTaskFeedReferenceData().catch(() => ({ categories: [] })),
  ]);
  const assignedByParticipation = splitWatchedTaskFeed(assigned);
  const authoredByParticipation = splitWatchedTaskFeed(authored);
  const split = splitAssignedTaskFeed(assignedByParticipation.tasks);
  return {
    mine: admin ? assignedByParticipation.tasks : split.myTasks,
    delegated: admin ? authoredByParticipation.tasks : split.delegatedTasks,
    inLoop: [...assignedByParticipation.inLoop, ...authoredByParticipation.inLoop.filter((task) => !assignedByParticipation.inLoop.some((watched) => watched.id === task.id))],
    categories: references.categories,
  };
}

/** Finds one task in any feed, preferring the viewer's own copy of the row. */
export function findWorkspaceTask(workspace: TaskWorkspace | null | undefined, taskId: string): TaskBundle | null {
  if (!workspace) return null;
  return workspace.mine.find((task) => task.id === taskId) ?? workspace.delegated.find((task) => task.id === taskId) ?? workspace.inLoop.find((task) => task.id === taskId) ?? null;
}
