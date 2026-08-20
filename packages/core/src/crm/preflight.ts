export type CrmPreflightSourceRecord = { externalId: string };
export type CrmPreflightMapping = { externalId: string; targetId: string };
export type CrmMappingPreflightReport = {
  unmappedExternalIds: string[];
  duplicateExternalIds: string[];
  danglingExternalIds: string[];
};

export function classifyCrmMappingPreflight(
  sourceRecords: readonly CrmPreflightSourceRecord[],
  mappings: readonly CrmPreflightMapping[],
  canonicalTargetIds: ReadonlySet<string>,
): CrmMappingPreflightReport {
  const mappingCounts = new Map<string, number>();
  const mappedIds = new Set<string>();
  const dangling = new Set<string>();
  for (const mapping of mappings) {
    const externalId = mapping.externalId.trim();
    if (externalId === "") continue;
    mappedIds.add(externalId);
    mappingCounts.set(externalId, (mappingCounts.get(externalId) ?? 0) + 1);
    if (!canonicalTargetIds.has(mapping.targetId)) dangling.add(externalId);
  }
  const sourceIds = new Set(sourceRecords.map((record) => record.externalId.trim()).filter(Boolean));
  return {
    unmappedExternalIds: [...sourceIds].filter((id) => !mappedIds.has(id)).sort(),
    duplicateExternalIds: [...mappingCounts].filter(([, count]) => count > 1).map(([id]) => id).sort(),
    danglingExternalIds: [...dangling].sort(),
  };
}
