/**
 * Customer privacy for the CRM tools (owner decision 2026-10-10).
 *
 * Never sent to the model: a full phone number, an email address, a street
 * address, an ID/KYC number, a document, or a photo. Phones appear only as their
 * last 4 digits ("…4521"); staff open the client's CRM record for contact
 * details. Names, MKC/MKF/MKREF codes, visit dates, interests, follow-up notes,
 * salesperson, branch, and status are allowed.
 *
 * Three layers:
 * 1. Executors copy only allow-listed fields; phone columns become `phoneLast4`.
 * 2. People-written text goes through `crmText`: scrubbed, then wrapped as
 *    untrusted data.
 * 3. `redactCrmResult` walks the finished result and scrubs every string again,
 *    so a value that slipped into any field (a remark, a name, a nested object)
 *    still cannot carry contact or ID data.
 */
import { untrusted, type UntrustedText } from "./shared.ts";

/** "…4521" for a stored phone (any format), or null when it has fewer than 4 digits. */
export function phoneLast4(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `…${digits.slice(-4)}` : null;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;
// Seven or more digits, optionally with one space, dash, dot, or bracket between them
// (phones, Aadhaar, account and other ID numbers). Dates and short numbers do not match.
const DIGIT_RUN = /\+?\(?\d(?:[\s\-.()]?\d){6,}/g;
const DATE_LIKE = /^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/;
const PAN = /\b[A-Z]{5}\d{4}[A-Z]\b/gi;
// Text kept intact: ids and record codes that legitimately contain long digit runs.
const PROTECTED = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\b(?:MKC|MKF|MKREF)-\d+\b)/gi;
// An address in a note: a 6-digit PIN code, or "flat/house/shop/room/plot no 12", or "address:".
const PINCODE = /(?<![\d…])\d{3}\s?\d{3}(?!\d)/;
const ADDRESS_HINT = /\bflat\s*(?:no\.?|number|#)?\s*[-:]?\s*\d+|\b(?:house|shop|room|plot|bldg|building|wing)\s*(?:no\.?|number|#)\s*[-:]?\s*\d+|\baddress\s*[:\-]|\b(?:road|rd\.|street|lane|marg|nagar|society|chs|apartments?|tower|sector|colony)\b[^.]{0,40}\d{3}\s?\d{3}\b/i;

export const ADDRESS_WITHHELD = "[note withheld: it may contain an address. Open the client in CRM to read it.]";

function scrubSegment(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(PAN, "[ID removed]")
    .replace(DIGIT_RUN, (match) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 7 || DATE_LIKE.test(match.trim())) return match;
      return `[number …${digits.slice(-4)}]`;
    });
}

/** Removes contact and ID data from free text; withholds a note that looks like an address. */
export function scrubCrmText(value: string): string {
  // Ids and codes are kept as they are; only the text between them is scrubbed.
  const parts = value.split(PROTECTED);
  const scrubbed = parts.map((part, index) => (index % 2 === 1 ? part : scrubSegment(part))).join("");
  const unprotected = parts.filter((_, index) => index % 2 === 0).join(" ");
  if (ADDRESS_HINT.test(unprotected) || (PINCODE.test(unprotected) && /\b(?:mumbai|thane|pune|delhi|west|east|\(w\)|\(e\)|near|opp|behind)\b/i.test(unprotected))) {
    return ADDRESS_WITHHELD;
  }
  return scrubbed;
}

/** People-written CRM text: scrubbed first, then wrapped as untrusted data (spec 12, rule 7). */
export function crmText(value: unknown, max = 300): UntrustedText | null {
  if (typeof value !== "string") return null;
  return untrusted(scrubCrmText(value), max);
}

/** The final pass over a CRM tool result: every string, at any depth, is scrubbed. */
export function redactCrmResult<T>(value: T): T {
  if (typeof value === "string") return scrubCrmText(value) as T;
  if (Array.isArray(value)) return value.map((entry) => redactCrmResult(entry)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redactCrmResult(entry)])) as T;
  }
  return value;
}
