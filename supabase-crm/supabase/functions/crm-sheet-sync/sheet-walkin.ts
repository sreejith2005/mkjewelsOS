// A WALKIN DATASET row (header -> cell text, as the Apps Script sends it) -> the canonical
// walk-in payload. The header-to-field map is the one the walk-in feed's Apps Script
// (supabase-crm/apps-script/crm-walkin-push.gs, SBCRM_FIELDS) has used since 2026-10-05, so
// both feeds read a row the same way; the payload is then built by the feed's own
// toCanonicalWalkinPayload. Added for the two-way sync: tags, GIFT GIVEN and proof URLs, which
// the CRM keeps and writes back.
import { toCanonicalWalkinPayload } from "../crm-walkin-ingest/legacy-walkin-ingest.ts";

export type SheetRow = Readonly<Record<string, string>>;

const FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["branch", ["BRANCH"]],
  ["client_name", ["CLIENT NAME"]],
  ["client_phone", ["CLIENT PHONE"]],
  ["billing_phone", ["BILLING PHONE"]],
  ["gender", ["GENDER"]],
  ["country", ["COUNTRY"]],
  ["state", ["STATE"]],
  ["city", ["CITY", "CITY (FINAL)"]],
  ["city_other", ["CITY (OTHER)"]],
  ["pincode", ["PINCODE"]],
  ["address", ["ADDRESS"]],
  ["caste", ["COMMUNITY"]],
  ["caste_other", ["COMMUNITY (OTHER)"]],
  ["client_potential_category", ["CLIENT POTENTIAL CATEGORY"]],
  ["high_potential_reason", ["WHY IS THIS CLIENT A HIGH-POTENTIAL BUYER?"]],
  ["remark", ["REMARK"]],
  ["product_requirement", ["REQUIREMENTS OF CLIENT", "PRODUCT REQUIREMENT"]],
  ["crm_name", ["CRM NAME"]],
  ["salesperson", ["SALESPERSON"]],
  ["buy_status", ["FINAL STATUS", "CLIENT BOUGHT ANY PRODUCT?"]],
  ["not_bought_other_text", ["NOT BOUGHT REASON (OTHER TEXT)"]],
  ["repair_approach", ["REPAIR/ORDER APPROACH"]],
  ["new_things_choice", ["NEW THINGS CHOICE"]],
  ["new_things_salesperson", ["NEW THINGS SALESPERSON"]],
  ["seen_count", ["SEEN PRODUCTS COUNT"]],
  ["seen_other_text", ["SEEN OTHER TEXT"]],
  ["bought_count", ["BOUGHT PRODUCTS COUNT"]],
  ["bought_other_text", ["BOUGHT OTHER TEXT"]],
  ["order_count", ["ORDER/NEW THINGS COUNT"]],
  ["order_other_text", ["ORDER/NEW THINGS OTHER TEXT"]],
  ["other_order", ["OTHER ORDER"]],
  ["marketing_message", ["MARKETING MESSAGE"]],
  ["instagram_follow_asked", ["INSTAGRAM FOLLOW ASKED"]],
  ["instagram_follow_no_reason", ["INSTAGRAM FOLLOW - NO REASON"]],
  ["google_review_asked", ["GOOGLE REVIEW ASKED"]],
  ["google_review_no_reason", ["GOOGLE REVIEW - NO REASON"]],
  ["testimonial_asked", ["TESTIMONIAL ASKED"]],
  ["testimonial_no_reason", ["TESTIMONIAL - NO REASON"]],
  ["feedback_asked", ["FEEDBACK FORM ASKED"]],
  ["feedback_no_reason", ["FEEDBACK FORM - NO REASON"]],
  ["thankyou_note", ["THANK-YOU NOTE GIVEN"]],
  ["thankyou_note_no_reason", ["THANK-YOU NOTE - NO REASON"]],
  ["referrals_asked", ["REFERRALS ASKED"]],
  ["referrals_no_reason", ["REFERRALS - NO REASON"]],
  ["beverage", ["BEVERAGE (FINAL)", "BEVERAGE"]],
  ["beverage_other", ["BEVERAGE (OTHER)"]],
  ["sugar", ["SUGAR (FINAL)", "SUGAR"]],
  ["sugar_other", ["SUGAR (OTHER)"]],
  ["snack", ["SNACK (FINAL)", "SNACK"]],
  ["snack_other", ["SNACK (OTHER)"]],
  ["gift_other", ["GIFT (OTHER)"]],
  ["other_store_visit", ["IF CLIENT WANTS TO VISIT ANOTHER STORE", "OTHER STORE CLIENT WANTS TO VISIT"]],
  ["occupation", ["OCCUPATION"]],
  ["occupation_other", ["OCCUPATION (OTHER)"]],
  ["bridal_status", ["BRIDAL / NON BRIDAL"]],
  ["wedding_month", ["MONTH OF WEDDING"]],
  ["wedding_year", ["YEAR OF WEDDING"]],
  ["communication_preference", ["COMMUNICATION PREFERENCE"]],
  ["source", ["SOURCE OF LEAD"]],
  ["source_other", ["SOURCE (OTHER)"]],
  ["reference_name", ["REFERENCE NAME"]],
  ["reference_phone", ["REFERENCE PHONE"]],
];

const LIST_FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["seen_categories", ["SEEN CATEGORIES", "SEEN CATEGORIES (FINAL)"]],
  ["bought_categories", ["BOUGHT CATEGORIES", "BOUGHT CATEGORIES(FINAL)"]],
  ["order_categories", ["ORDER/NEW THINGS CATEGORIES", "OTHER/ NEW PRODUCTS"]],
  ["not_bought_reasons", ["NOT BOUGHT REASONS", "NOT BOUGHT REASONS (FINAL)"]],
  ["more_design_categories", ["WHICH CATEGORIES CLIENT WANT TO SEE MORE"]],
];

const DATE_FIELDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["visit_date", ["CLIENT VISIT DATE", "VISIT DATE", "TIMESTAMP"]],
  ["dob", ["DOB"]],
  ["anniversary", ["ANNIVERSARY"]],
  ["next_visit_date", ["NEXT VISIT DATE"]],
];

const PROOF_URLS: ReadonlyArray<readonly [string, string]> = [
  ["instagram", "INSTAGRAM FOLLOW - PROOF URL"],
  ["google_review", "GOOGLE REVIEW - SCREENSHOT URL"],
  ["testimonial", "TESTIMONIAL - MEDIA URL"],
  ["feedback_form", "FEEDBACK FORM - SCREENSHOT URL"],
  ["thank_you_note", "THANK-YOU NOTE - PHOTO URL"],
  ["referrals", "REFERRALS - PROOF URL"],
];

function cell(row: SheetRow, header: string): string {
  return String(row[header] ?? "").trim().slice(0, 2000);
}

function pick(row: SheetRow, headers: readonly string[]): string {
  for (const header of headers) {
    const value = cell(row, header);
    if (value) return value;
  }
  return "";
}

function list(value: string): string[] {
  return value.split(/\s*,\s*/).filter(Boolean).slice(0, 40);
}

/** yyyy-mm-dd from yyyy-mm-dd[...] or dd/mm/yyyy[...], as the feed's sbcrmDate_. */
export function sheetDate(value: string): string {
  let m = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return "";
}

/** The walk-in feed's formDataObj for a row. */
export function sheetRowToFormData(row: SheetRow, reference: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, headers] of FIELDS) {
    const value = pick(row, headers);
    if (value) out[field] = value;
  }
  for (const [field, headers] of LIST_FIELDS) {
    for (const header of headers) {
      const values = list(cell(row, header));
      if (values.length) { out[field] = values; break; }
    }
  }
  for (const [field, headers] of DATE_FIELDS) {
    for (const header of headers) {
      const value = sheetDate(cell(row, header));
      if (value) { out[field] = value; break; }
    }
  }
  for (let n = 1; n <= 10; n += 1) {
    const name = cell(row, `COMPANION ${n} NAME`);
    const phone = cell(row, `COMPANION ${n} MOBILE`);
    const relation = cell(row, `COMPANION ${n} RELATION`);
    if (name) out[`companion_name_${n}`] = name;
    if (phone) out[`companion_phone_${n}`] = phone;
    if (relation) out[`companion_relation_${n}`] = relation;
  }
  out.reference_number = reference;
  return out;
}

/** The canonical walk-in payload for a row (branch_id is set by the database). */
export function sheetRowToWalkinPayload(row: SheetRow, reference: string): Record<string, unknown> {
  const payload = toCanonicalWalkinPayload(sheetRowToFormData(row, reference), "") as Record<string, unknown>;
  delete payload.branch_id;
  const details = { ...(payload.category_details as Record<string, unknown>) };
  details.seen_tags = list(cell(row, "SEEN TAGS (COMBINED)"));
  details.bought_tags = list(cell(row, "BOUGHT TAGS (COMBINED)"));
  details.order_tags = list(cell(row, "ORDER/NEW THINGS TAGS (COMBINED)"));
  payload.category_details = details;
  const extra = { ...(payload.additional_fields as Record<string, unknown>) };
  const gift = cell(row, "GIFT GIVEN") || cell(row, "GIFT GIVEN (FINAL)");
  if (gift) extra.gift_given = gift;
  payload.additional_fields = extra;
  payload.proof_urls = Object.fromEntries(PROOF_URLS.map(([field, header]) => [field, cell(row, header)]).filter(([, value]) => value));
  return payload;
}
