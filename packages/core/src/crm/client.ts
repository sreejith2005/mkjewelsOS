import { isValidEmail, isValidIndianPincode, normalizeIndianPhone } from "./phone";
import type { ClientInput, NormalizedClientInput } from "./types";

const clean = (value?: string) => value?.trim().replace(/\s+/g, " ") || undefined;

export function validateContact(input: Pick<ClientInput, "primaryPhone" | "billingPhone" | "email" | "pincode">): string[] {
  const errors: string[] = [];
  const primary = normalizeIndianPhone(input.primaryPhone);
  const billing = input.billingPhone ? normalizeIndianPhone(input.billingPhone) : null;
  if (!primary) errors.push("Enter a supported Indian mobile number.");
  if (input.billingPhone && !billing) errors.push("Enter a valid billing or alternate mobile number.");
  if (primary && billing && primary.normalized === billing.normalized) errors.push("Primary and billing phones must be different.");
  if (input.email && !isValidEmail(input.email)) errors.push("Enter a valid email address.");
  if (input.pincode && !isValidIndianPincode(input.pincode)) errors.push("Enter a valid six-digit Indian pincode.");
  return errors;
}

export function normalizeClientInput(input: ClientInput): NormalizedClientInput {
  const errors = validateContact(input);
  if (!clean(input.firstName)) errors.push("First name is required.");
  if (errors.length) throw new Error(errors.join(" "));
  const primary = normalizeIndianPhone(input.primaryPhone)!;
  const billing = input.billingPhone ? normalizeIndianPhone(input.billingPhone)! : undefined;
  const normalized = {
    ...input,
    firstName: clean(input.firstName)!, lastName: clean(input.lastName),
    primaryPhone: primary.display, normalizedPhone: primary.normalized,
    billingPhone: billing?.display, normalizedBillingPhone: billing?.normalized,
    email: clean(input.email)?.toLowerCase(), gender: clean(input.gender),
    address: clean(input.address), city: clean(input.city), state: clean(input.state), pincode: clean(input.pincode),
    potentialCategory: clean(input.potentialCategory), communicationPreference: clean(input.communicationPreference),
    tags: [...new Set((input.tags ?? []).map((tag) => clean(tag)?.toLowerCase()).filter((tag): tag is string => !!tag))].slice(0, 20),
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined)) as NormalizedClientInput;
}

export type ContactCandidate = { id: string; normalizedPhone: string; normalizedBillingPhone?: string; aliases?: readonly string[]; active?: boolean };
export function findDuplicateContactMatches(normalized: string, candidates: readonly ContactCandidate[]): string[] {
  return candidates.filter((item) => item.active !== false && (item.normalizedPhone === normalized || item.normalizedBillingPhone === normalized || item.aliases?.includes(normalized))).map((item) => item.id);
}
