import { normalizeIndianPhone } from "./phone";

export type LegacyClientImportInput = {
  externalId: string;
  primaryName: string;
  primaryPhone: string;
  legacyBranchId?: string | null;
};

export type LegacyClientImportPreparation = {
  externalId: string;
  firstName: string;
  phone: string;
  normalizedPhone: string | null;
  legacyBranchId: string | null;
  reviewCodes: Array<"invalid_phone" | "missing_branch">;
};

export function prepareLegacyClientImport(input: LegacyClientImportInput): LegacyClientImportPreparation {
  const externalId = input.externalId.trim();
  if (externalId === "") throw new Error("legacy client external ID is required");
  const phone = input.primaryPhone.trim();
  if (phone === "") throw new Error("legacy client phone value is required");
  const legacyBranchId = input.legacyBranchId?.trim() || null;
  const normalizedPhone = normalizeIndianPhone(phone)?.normalized ?? null;
  const reviewCodes: LegacyClientImportPreparation["reviewCodes"] = [];
  if (normalizedPhone === null) reviewCodes.push("invalid_phone");
  if (legacyBranchId === null) reviewCodes.push("missing_branch");
  return { externalId, firstName: input.primaryName.trim(), phone, normalizedPhone, legacyBranchId, reviewCodes };
}

export type LegacyTimelineImportInput = {
  externalId: string;
  clientExternalId: string;
  branchExternalId: string | null;
  eventType: string;
  occurredAt: string;
};

export type LegacyTimelineImportPreparation = {
  externalId: string;
  clientExternalId: string;
  branchExternalId: string | null;
  eventType: "walkin";
  subject: string;
  reviewCodes: Array<"missing_branch" | "invalid_date">;
};

export function prepareLegacyTimelineImport(input: LegacyTimelineImportInput): LegacyTimelineImportPreparation {
  const externalId = input.externalId.trim();
  const clientExternalId = input.clientExternalId.trim();
  if (externalId === "" || clientExternalId === "") throw new Error("legacy timeline and client external IDs are required");
  const branchExternalId = input.branchExternalId?.trim() || null;
  const normalizedEvent = input.eventType.trim().toLowerCase().replaceAll("_", " ").replace("non purchase", "non-purchase");
  const reviewCodes: LegacyTimelineImportPreparation["reviewCodes"] = [];
  if (branchExternalId === null) reviewCodes.push("missing_branch");
  if (Number.isNaN(Date.parse(input.occurredAt))) reviewCodes.push("invalid_date");
  return {
    externalId,
    clientExternalId,
    branchExternalId,
    eventType: "walkin",
    subject: `Legacy ${normalizedEvent || "visit"}`,
    reviewCodes,
  };
}
