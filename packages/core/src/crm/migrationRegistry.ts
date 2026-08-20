export type CrmSourceEntityType = "branch" | "staff" | "client" | "timeline" | "followup" | "document";

export type CrmSourceMappingInput = {
  sourceKey: string;
  externalId: string;
  entityType: CrmSourceEntityType;
  displayName?: string;
};

export type CrmSourceMapping = Pick<CrmSourceMappingInput, "sourceKey" | "externalId" | "entityType">;

export function validateCrmSourceMapping(input: CrmSourceMappingInput): CrmSourceMapping {
  const sourceKey = input.sourceKey.trim().toLowerCase();
  const externalId = input.externalId.trim();
  if (!/^[a-z][a-z0-9_]{2,62}$/.test(sourceKey)) throw new Error("source key is invalid");
  if (externalId === "") throw new Error("external ID is required; display names cannot authorize a mapping");
  if (externalId.length > 255) throw new Error("external ID is too long");
  return { sourceKey, externalId, entityType: input.entityType };
}
