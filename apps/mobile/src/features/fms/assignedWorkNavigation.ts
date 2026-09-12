import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { FmsAssignedWorkTarget } from "@jewelos/core";
import type { RootStackParamList } from "@/navigation/types";

/**
 * The native half of the cross-client FMS work contract.
 *
 * `@jewelos/core` decides *what* a piece of assigned FMS work is; this module
 * decides which native screen renders it. Web resolves the same union into a
 * URL (`fmsAssignedWorkPath`), so the two clients cannot disagree about which
 * surface a given assignment opens. Keep the mapping here rather than inside
 * screens, so every entry surface — Home, Tasks, task detail, notifications —
 * lands on one implementation.
 */
export type FmsAssignedWorkRoute =
  | Readonly<{ screen: "FormFill"; params: RootStackParamList["FormFill"] }>
  | Readonly<{ screen: "FmsStageForm"; params: RootStackParamList["FmsStageForm"] }>
  | Readonly<{ screen: "FmsStage"; params: RootStackParamList["FmsStage"] }>
  | Readonly<{ screen: "FmsInstance"; params: RootStackParamList["FmsInstance"] }>;

export function fmsAssignedWorkRoute(target: FmsAssignedWorkTarget): FmsAssignedWorkRoute {
  if (target.kind === "starter_form") {
    return {
      screen: "FormFill",
      params: { formTemplateId: target.formTemplateId, starterAssignmentId: target.starterAssignmentId },
    };
  }
  if (target.kind === "stage_form") {
    return {
      screen: "FmsStageForm",
      params: {
        instanceId: target.instanceId,
        instanceStageId: target.instanceStageId,
        formTemplateId: target.formTemplateId,
      },
    };
  }
  // A legacy instance-only link cannot name a stage, so it opens the instance
  // workspace and lets the runner pick up the viewer's actionable stage.
  return target.instanceStageId
    ? { screen: "FmsStage", params: { instanceId: target.instanceId, instanceStageId: target.instanceStageId } }
    : { screen: "FmsInstance", params: { instanceId: target.instanceId } };
}

/** The identity columns `v_all_tasks` exposes for FMS work (migration 0160). */
export type FmsAssignedWorkTaskRow = Readonly<{
  task_type: string | null;
  form_template_id: string | null;
  fms_work_source: string | null;
  fms_instance_id: string | null;
  fms_instance_stage_id: string | null;
  fms_starter_assignment_id: string | null;
}>;

/**
 * Resolves a task-feed row to its FMS surface, or `null` when the row is
 * ordinary work that the normal `TaskForm` route already handles.
 *
 * Starter work is identified by its assignment id rather than inferred from the
 * form id: one form template backs many starter assignments, so inferring would
 * open another user's work.
 */
export function fmsAssignedWorkRouteForTask(task: FmsAssignedWorkTaskRow): FmsAssignedWorkRoute | null {
  if (task.task_type !== "fms") return null;

  if (task.fms_work_source === "fms_starter") {
    if (!task.fms_starter_assignment_id || !task.form_template_id) return null;
    return fmsAssignedWorkRoute({
      kind: "starter_form",
      starterAssignmentId: task.fms_starter_assignment_id,
      formTemplateId: task.form_template_id,
    });
  }

  if (!task.fms_instance_id) return null;
  if (task.form_template_id && task.fms_instance_stage_id) {
    return fmsAssignedWorkRoute({
      kind: "stage_form",
      instanceId: task.fms_instance_id,
      instanceStageId: task.fms_instance_stage_id,
      formTemplateId: task.form_template_id,
    });
  }
  return fmsAssignedWorkRoute({
    kind: "stage",
    instanceId: task.fms_instance_id,
    instanceStageId: task.fms_instance_stage_id,
  });
}

/**
 * Dispatches a resolved route.
 *
 * React Navigation types `navigate` as a union of screen/param tuples, so a
 * value typed as "one of several screens" cannot be passed straight through.
 * Switching narrows each branch to a single screen and its exact params, which
 * keeps the param types checked instead of cast away at the call site.
 */
export function navigateFmsAssignedWork(
  navigation: Pick<NativeStackNavigationProp<RootStackParamList>, "navigate">,
  route: FmsAssignedWorkRoute,
): void {
  switch (route.screen) {
    case "FormFill":
      navigation.navigate(route.screen, route.params);
      return;
    case "FmsStageForm":
      navigation.navigate(route.screen, route.params);
      return;
    case "FmsStage":
      navigation.navigate(route.screen, route.params);
      return;
    case "FmsInstance":
      navigation.navigate(route.screen, route.params);
  }
}
