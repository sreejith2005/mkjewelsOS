/**
 * Per-workflow FMS access (migration 0390). A grant covers every version of
 * one workflow. The database decides (`can_edit_fms_flow`,
 * `can_publish_fms_flow`); this mirrors it so the FMS list offers only the
 * actions the server will accept.
 */
export const FMS_FLOW_ACCESS_LEVELS = ["view", "edit", "publish"] as const;
export type FmsFlowAccessLevel = (typeof FMS_FLOW_ACCESS_LEVELS)[number];

export const FMS_FLOW_ACCESS_LABELS: Readonly<Record<FmsFlowAccessLevel, Readonly<{ label: string; description: string }>>> = {
  view: { label: "View only", description: "Open the workflow and read its steps, conditions and assignees. No changes." },
  edit: { label: "Edit", description: "Change drafts and start a new version. Cannot publish." },
  publish: { label: "Edit and publish", description: "Edit, publish, and pause or resume the live version." },
};

export type FmsFlowCapabilities = Readonly<{
  /** Open the workflow in the builder. */
  view: boolean;
  /** Save drafts and start a new version. */
  edit: boolean;
  /** Publish, pause / resume, change the live start trigger. */
  publish: boolean;
  /** Archive, delete, restore, version history and who has access: `fms.manage` only. */
  manage: boolean;
}>;

export function isFmsFlowAccessLevel(value: unknown): value is FmsFlowAccessLevel {
  return typeof value === "string" && (FMS_FLOW_ACCESS_LEVELS as readonly string[]).includes(value);
}

/** What one person may do with one workflow: full builder rights, or their grant on it. */
export function fmsFlowCapabilities(managesWorkflows: boolean, grant: FmsFlowAccessLevel | null | undefined): FmsFlowCapabilities {
  if (managesWorkflows) return { view: true, edit: true, publish: true, manage: true };
  return {
    view: grant !== null && grant !== undefined,
    edit: grant === "edit" || grant === "publish",
    publish: grant === "publish",
    manage: false,
  };
}
