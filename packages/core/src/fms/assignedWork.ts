export type FmsAssignedWorkTarget =
  | Readonly<{
      kind: "starter_form";
      starterAssignmentId: string;
      formTemplateId: string;
    }>
  | Readonly<{
      kind: "stage_form";
      instanceId: string;
      instanceStageId: string;
      formTemplateId: string;
    }>
  | Readonly<{
      kind: "stage";
      instanceId: string;
      instanceStageId: string | null;
    }>;

export function fmsAssignedWorkPath(target: FmsAssignedWorkTarget): string {
  const params = new URLSearchParams();
  if (target.kind === "starter_form") {
    params.set("starter", target.starterAssignmentId);
    params.set("form", target.formTemplateId);
  } else {
    params.set("instance", target.instanceId);
    if (target.instanceStageId) params.set("stage", target.instanceStageId);
    if (target.kind === "stage_form") params.set("form", target.formTemplateId);
  }
  return `/tasks/fms?${params.toString()}`;
}

export function parseFmsAssignedWorkPath(path: string): FmsAssignedWorkTarget | null {
  const url = new URL(path, "https://jewelos.invalid");
  if (url.pathname !== "/tasks/fms") return null;

  const starterAssignmentId = url.searchParams.get("starter");
  const instanceId = url.searchParams.get("instance");
  const instanceStageId = url.searchParams.get("stage");
  const formTemplateId = url.searchParams.get("form");

  if (starterAssignmentId) {
    if (!formTemplateId || instanceId || instanceStageId) return null;
    return { kind: "starter_form", starterAssignmentId, formTemplateId };
  }

  if (!instanceId) return null;
  if (formTemplateId) {
    if (!instanceStageId) return null;
    return { kind: "stage_form", instanceId, instanceStageId, formTemplateId };
  }
  return { kind: "stage", instanceId, instanceStageId };
}
