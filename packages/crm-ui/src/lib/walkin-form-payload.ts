// crm-port: the submit_walkin_visit payload from a walk-in visit filled in a linked Form Builder
// form (CRM Form Settings, owner request 2026-11-03). It is the same payload the standard
// walk-in form (components/walk-in-form.tsx) builds, key for key, so the server treats a linked
// form's visit exactly like a standard one.
import { crmAnswersFromForm, crmLinkedAnswer, CRM_WALKIN_ENGAGEMENT, CRM_WALKIN_PRODUCT_LISTS, formRepeatRowCount, isFormCrmFilesAnswer, isFormRepeatAnswer, type CrmFieldMap, type FormAnswers, type FormCrmFile } from "@jewelos/core";

import { asList, legacyWeddingMonthNumber, storageFileName } from "@/components/walk-in-form";
import { composePhone, DEFAULT_COUNTRY_CODE } from "@/lib/phone";

/** Every key the standard walk-in form sends (its initial values), so absent answers stay "". */
const LEGACY_KEYS = [
  "client_id", "entry_queue_id", "event_date", "branch_id", "crm_name", "primary_name", "primary_phone", "billing_phone", "gender", "country", "state", "city", "city_other",
  "pincode", "address", "community", "community_other", "dob", "anniversary", "source_of_lead", "source_of_lead_other", "reference_name", "reference_phone", "client_type", "did_buy",
  "visit_status", "not_bought_other", "repair_or_order_approach", "marketing_message_sent", "occupation", "occupation_other", "bridal_or_non_bridal", "wedding_month", "wedding_year",
  "communication_preference", "beverage", "sugar", "snack", "beverage_other", "sugar_other", "snack_other", "gift", "gift_other", "next_visit_date", "client_potential_category",
  "high_potential_reason", "remark", "product_requirement", "other_store_client_wants_to_visit", "categories_client_wants_more", "seen_categories", "bought_categories", "order_categories",
  "seen_other", "bought_other", "order_other", "salesperson_handled", "salesperson", "salesperson_id", "new_things_choice", "other_order", "came_for_categories", "came_for_other",
  "new_things_categories", "new_things_other", "referrals_count", "companions_count", "seen_count", "bought_count", "order_count", "camefor_count", "new_things_count",
] as const;

/** A coded choice ("REPAIR PLACED" on screen) as the standard form stores it ("REPAIR_PLACED"). */
const code = (text: string | undefined) => (text ?? "").trim().toUpperCase().replaceAll(" ", "_");
const phone = (text: string | undefined) => text?.trim() ? composePhone(DEFAULT_COUNTRY_CODE, text) : "";

export type WalkinFormContext = Readonly<{
  queueId: string;
  branchId: string;
  /** The client this visit is for (resolved by the phone lookup or the queue), or "" for a new one. */
  clientId: string;
  clientType: "new" | "existing";
  proposedClientId: string;
  proposedTimelineId: string;
  salespeople: readonly { id: string; name: string }[];
}>;

export type SubmittedWalkin = Readonly<{
  answers: FormAnswers;
  display: Readonly<Record<string, string>>;
  /** Each repeating group's rows as the person saw them (choice labels). */
  rowDisplay?: Readonly<Record<string, readonly Readonly<Record<string, string>>[]>> | undefined;
}>;

export function walkinPayloadFromForm(fieldMap: CrmFieldMap, submitted: SubmittedWalkin, context: WalkinFormContext): { payload: Record<string, unknown>; files: FormCrmFile[] } {
  const text = crmAnswersFromForm(fieldMap, submitted.answers, submitted.display);
  const rows = (target: string) => {
    const found = crmLinkedAnswer(fieldMap, target, submitted.answers);
    if (!found || !isFormRepeatAnswer(found.value)) return { count: "", rows: [] as Readonly<Record<string, string>>[] };
    const answer = found.value;
    const shown = submitted.rowDisplay?.[found.fieldKey];
    const size = formRepeatRowCount(answer);
    return { count: answer.count, rows: Array.from({ length: size }, (_, index) => shown?.[index] ?? answer.rows[index] ?? {}) };
  };
  const files = (target: string): FormCrmFile[] => {
    const found = crmLinkedAnswer(fieldMap, target, submitted.answers);
    return found && isFormCrmFilesAnswer(found.value) ? [...found.value.files] : [];
  };

  const values: Record<string, string> = Object.fromEntries(LEGACY_KEYS.map((key) => [key, ""]));
  for (const [key, value] of Object.entries(text)) values[key] = value;
  for (const key of ["visit_status", "repair_or_order_approach", "marketing_message_sent", "new_things_choice", "other_order"]) values[key] = code(text[key]);
  values.client_id = context.clientId;
  values.entry_queue_id = context.queueId;
  values.branch_id = context.branchId;
  values.client_type = context.clientType;
  values.source_of_lead = text.source_of_lead ?? "Walk-in";
  values.salesperson_id = context.salespeople.find((person) => person.name === text.salesperson)?.id ?? "";

  const lists = Object.fromEntries(CRM_WALKIN_PRODUCT_LISTS.map((list) => [list.key, rows(list.tags)]));
  for (const list of CRM_WALKIN_PRODUCT_LISTS) values[`${list.key}_count`] = lists[list.key]!.count;
  const companions = rows("companions");
  values.companions_count = companions.count;
  const referrals = rows("referrals");
  values.referrals_count = referrals.count;

  const engagement = Object.fromEntries(CRM_WALKIN_ENGAGEMENT.flatMap((ask) => {
    const asked = code(text[`engagement_${ask.key}`]);
    return asked ? [[ask.key, { asked, no_reason: text[`engagement_${ask.key}_reason`] ?? "" }]] : [];
  })) as Record<string, { asked: string; no_reason: string }>;

  const proofs: Array<{ purpose: string; file: FormCrmFile }> = [
    ...CRM_WALKIN_ENGAGEMENT.flatMap((ask) => engagement[ask.key]?.asked === "YES" ? files(`engagement_${ask.key}_proof`).slice(0, 1).map((file) => ({ purpose: ask.key, file })) : []),
    ...files("remark_photos").slice(0, 10).map((file, index) => ({ purpose: `remark_photo_${index + 1}`, file })),
  ];

  const primaryPhone = phone(text.primary_phone);
  const payload: Record<string, unknown> = {
    ...values,
    client_id: context.clientId,
    proposed_client_id: context.proposedClientId,
    proposed_timeline_id: context.proposedTimelineId,
    primary_phone: primaryPhone,
    billing_phone: phone(text.billing_phone) || primaryPhone,
    event_date: values.event_date ? `${values.event_date.slice(0, 16)}:00+05:30` : undefined,
    did_buy: values.visit_status === "YES",
    wedding_month: legacyWeddingMonthNumber(values.wedding_month ?? ""),
    companions: companions.rows.map((row) => ({ name: row.name ?? "", mobile: row.mobile ?? "", relation: row.relation ?? "" })).filter((item) => item.name || item.mobile || item.relation),
    not_bought_reasons: asList(text.not_bought_reasons ?? ""),
    seen_categories: asList(values.seen_categories ?? ""),
    bought_categories: asList(values.bought_categories ?? ""),
    order_categories: asList(values.order_categories ?? ""),
    documents: proofs.map(({ purpose, file }) => ({ purpose, original_file_name: file.fileName, storage_path: file.path, file_name: storageFileName(file.path, file.fileName), mime_type: file.mimeType })),
    category_details: {
      seen_count: values.seen_count, bought_count: values.bought_count, order_count: values.order_count, camefor_count: values.camefor_count, new_things_count: values.new_things_count,
      ...Object.fromEntries(CRM_WALKIN_PRODUCT_LISTS.map((list) => [`${list.key}_tags`, lists[list.key]!.rows.map((row) => row.tag ?? "")])),
      seen_other: values.seen_other, bought_other: values.bought_other, order_other: values.order_other,
      came_for_categories: asList(values.came_for_categories ?? ""), came_for_other: values.came_for_other,
      new_things_categories: asList(values.new_things_categories ?? ""), new_things_other: values.new_things_other,
      salesperson_handled: values.salesperson_handled, new_things_choice: values.new_things_choice,
    },
    engagement: Object.fromEntries(Object.entries(engagement).map(([key, item]) => [key, { asked: item.asked === "YES", no_reason: item.no_reason }])),
    additional_fields: {
      visit_status: values.visit_status, other_order: values.other_order,
      came_for_categories: asList(values.came_for_categories ?? ""), came_for_other: values.came_for_other,
      new_things_categories: asList(values.new_things_categories ?? ""), new_things_other: values.new_things_other,
      referrals_count: values.referrals_count, companions_count: values.companions_count, salesperson: values.salesperson,
      engagement_answers: Object.fromEntries(Object.entries(engagement).map(([key, item]) => [key, item.asked])),
      referrals: referrals.rows.map((row) => ({ name: row.name ?? "", mobile: row.mobile ?? "" })).filter((item) => item.name || item.mobile),
      beverage_other: values.beverage_other, sugar_other: values.sugar_other, snack_other: values.snack_other,
      gift: values.gift, gift_other: values.gift_other,
      other_store_client_wants_to_visit: values.other_store_client_wants_to_visit,
      categories_client_wants_more: asList(values.categories_client_wants_more ?? ""),
    },
  };
  return { payload, files: proofs.map(({ file }) => file) };
}
