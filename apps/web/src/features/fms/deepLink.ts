export type FmsFormDeepLink = Readonly<{ instanceId: string; instanceStageId: string; formTemplateId: string }>;

export function fmsFormDeepLinkPath(link: FmsFormDeepLink): string {
  return `/tasks/fms?${new URLSearchParams({ instance: link.instanceId, stage: link.instanceStageId, form: link.formTemplateId }).toString()}`;
}

export function parseFmsFormDeepLink(path: string): FmsFormDeepLink | null {
  const params = new URL(path, "https://jewelos.invalid").searchParams;
  const instanceId = params.get("instance");
  const instanceStageId = params.get("stage");
  const formTemplateId = params.get("form");
  return instanceId && instanceStageId && formTemplateId ? { instanceId, instanceStageId, formTemplateId } : null;
}
