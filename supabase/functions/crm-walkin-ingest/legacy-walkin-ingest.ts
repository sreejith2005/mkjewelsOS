// Verbatim port of sreejith-crm/web-app/lib/legacy-walkin-ingest.ts (zod 4.3.6, the original version),
// so validation messages match the original endpoint. Only this comment is added.
import { z } from "zod";

const MAX_TEXT_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 40;

const scalar = z.union([z.string().max(MAX_TEXT_LENGTH), z.number(), z.boolean(), z.null()]);
const fieldValue = z.union([scalar, z.array(scalar).max(MAX_ARRAY_ITEMS)]);

export const legacyWalkinEnvelopeSchema = z
  .object({
    formDataObj: z.record(z.string().max(100), fieldValue).refine(
      (value) => Object.keys(value).length <= 180,
      "Too many form fields.",
    ),
    // Files are recognized so the legacy caller gets a deliberate, actionable
    // response rather than silently losing proof uploads. The CRM Storage
    // upload bridge is intentionally a separate change.
    filesPayload: z
      .array(
        z.object({
          fieldName: z.string().max(100),
          fileName: z.string().max(255),
          mimeType: z.string().max(255),
          base64: z.string().max(8_000_000),
        }),
      )
      .max(8)
      .default([]),
  })
  .strict();

export type LegacyWalkinEnvelope = z.infer<typeof legacyWalkinEnvelopeSchema>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function list(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  return values.map(text).filter(Boolean).slice(0, MAX_ARRAY_ITEMS);
}

function yes(value: unknown): boolean {
  return text(value).toUpperCase() === "YES";
}

function dateAtMidnight(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function nullable(value: unknown): string | null {
  return text(value) || null;
}

export function legacyPayloadForAudit(envelope: LegacyWalkinEnvelope): Record<string, unknown> {
  return {
    formDataObj: envelope.formDataObj,
    // Base64 proof data is never copied into the troubleshooting log.
    filesPayload: envelope.filesPayload.map(({ fieldName, fileName, mimeType }) => ({
      fieldName,
      fileName,
      mimeType,
    })),
  };
}

export function toCanonicalWalkinPayload(form: Record<string, unknown>, branchId: string): Record<string, unknown> {
  const companions = Array.from({ length: 10 }, (_, index) => {
    const number = index + 1;
    return {
      name: text(form[`companion_name_${number}`]),
      phone: text(form[`companion_phone_${number}`]),
      relation: text(form[`companion_relation_${number}`]),
    };
  }).filter((companion) => companion.name || companion.phone || companion.relation);

  return {
    branch_id: branchId,
    primary_name: text(form.client_name),
    primary_phone: text(form.client_phone) || text(form.billing_phone),
    billing_phone: nullable(form.billing_phone),
    gender: nullable(form.gender),
    country: nullable(form.country),
    state: nullable(form.state),
    city: nullable(form.city),
    city_other: nullable(form.city_other),
    pincode: nullable(form.pincode),
    address: nullable(form.address),
    community: nullable(form.caste),
    community_other: nullable(form.caste_other),
    dob: nullable(form.dob),
    anniversary: nullable(form.anniversary),
    beverage: nullable(form.beverage),
    sugar: nullable(form.sugar),
    snack: nullable(form.snack),
    next_visit_date: nullable(form.next_visit_date),
    client_potential_category: nullable(form.client_potential_category),
    high_potential_reason: nullable(form.high_potential_reason),
    remark: nullable(form.remark),
    product_requirement: nullable(form.product_requirement),
    crm_name: nullable(form.crm_name),
    event_date: dateAtMidnight(form.visit_date),
    did_buy: yes(form.buy_status),
    companions,
    seen_categories: list(form.seen_categories),
    bought_categories: list(form.bought_categories),
    order_categories: list(form.order_categories),
    not_bought_reasons: list(form.not_bought_reasons),
    not_bought_other: nullable(form.not_bought_other_text),
    repair_or_order_approach: nullable(form.repair_approach),
    marketing_message_sent: nullable(form.marketing_message),
    occupation: nullable(form.occupation),
    occupation_other: nullable(form.occupation_other),
    bridal_or_non_bridal: nullable(form.bridal_status),
    wedding_month: nullable(form.wedding_month),
    wedding_year: nullable(form.wedding_year),
    communication_preference: nullable(form.communication_preference),
    source_of_lead: nullable(form.source),
    source_of_lead_other: nullable(form.source_other),
    reference_name: nullable(form.reference_name),
    reference_phone: nullable(form.reference_phone),
    entry_queue_id: nullable(form.entry_token),
    category_details: {
      seen_count: nullable(form.seen_count),
      seen_other_text: nullable(form.seen_other_text),
      bought_count: nullable(form.bought_count),
      bought_other_text: nullable(form.bought_other_text),
      order_count: nullable(form.order_count),
      order_other_text: nullable(form.order_other_text),
      camefor_count: nullable(form.camefor_count),
      camefor_other_text: nullable(form.camefor_other_text),
      new_things_choice: nullable(form.new_things_choice),
      new_things_salesperson: nullable(form.new_things_salesperson),
      new_things_count: nullable(form.new_things_count),
      new_things_other_text: nullable(form.new_things_other_text),
      other_order: nullable(form.other_order),
    },
    engagement: {
      instagram: { asked: yes(form.instagram_follow_asked), no_reason: nullable(form.instagram_follow_no_reason) },
      google_review: { asked: yes(form.google_review_asked), no_reason: nullable(form.google_review_no_reason) },
      testimonial: { asked: yes(form.testimonial_asked), no_reason: nullable(form.testimonial_no_reason) },
      feedback_form: { asked: yes(form.feedback_asked), no_reason: nullable(form.feedback_no_reason) },
      thank_you_note: { asked: yes(form.thankyou_note), no_reason: nullable(form.thankyou_note_no_reason) },
      referrals: { asked: yes(form.referrals_asked), no_reason: nullable(form.referrals_no_reason) },
    },
    additional_fields: {
      legacy_reference_number: nullable(form.reference_number),
      legacy_form_mode: nullable(form.form_mode),
      legacy_edit_reference_number: nullable(form.edit_reference_number),
      salesperson: nullable(form.salesperson),
      other_store_visit: nullable(form.other_store_visit),
      more_design_categories: list(form.more_design_categories),
      more_design_other_text: nullable(form.more_design_other_text),
      beverage_other: nullable(form.beverage_other),
      sugar_other: nullable(form.sugar_other),
      snack_other: nullable(form.snack_other),
      gift_other: nullable(form.gift_other),
      referral_count: nullable(form.referrals_count),
    },
  };
}
