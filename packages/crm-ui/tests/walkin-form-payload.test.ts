// A walk-in visit filled in the linked Form Builder walk-in form must reach submit_walkin_visit as
// the same payload the standard walk-in form sends (owner request 2026-11-03).
import { describe, expect, it } from "vitest";
import { crmWalkinFormCopy } from "@jewelos/core";

import { walkinPayloadFromForm } from "@/lib/walkin-form-payload";

const { fieldMap } = crmWalkinFormCopy({ gender: ["FEMALE"], lookup_relations: ["WIFE"], lookup_product_categories: ["RINGS", "OTHER"] }, [], 2026);
const context = { queueId: "q1", branchId: "b1", clientId: "c1", clientType: "existing" as const, proposedClientId: "c1", proposedTimelineId: "t1", salespeople: [{ id: "s1", name: "Priya" }] };
const file = (name: string) => ({ path: `c1/t1/0f8fad5b-d9cb-469f-a165-70867728950e_${name}`, clientId: "c1", fileName: name, mimeType: "image/jpeg" });

describe("walk-in payload from a linked form", () => {
  it("builds the standard walk-in payload for a bought visit with products, companions, engagement and photos", () => {
    const answers = {
      event_date: "2026-11-04T11:30", primary_name: "Asha", primary_phone: "98765 43210", salesperson: "Priya", crm_name: "CRM One", gender: "female",
      visit_status: "yes", bought_categories: ["rings", "other"], bought_tags: { kind: "repeat" as const, count: "2", rows: [{ tag: "R-1" }, { tag: "R-2" }] }, bought_other: "Anklet",
      other_order: "no", companions: { kind: "repeat" as const, count: "1", rows: [{ name: "Ravi", mobile: "9000000000", relation: "wife" }] },
      engagement_google_review: "yes", engagement_google_review_proof: { kind: "crm_files" as const, files: [file("review.jpg")] },
      engagement_instagram: "no", engagement_instagram_reason: "No phone", engagement_referrals: "yes",
      referrals: { kind: "repeat" as const, count: "1", rows: [{ name: "Meera", mobile: "9111111111" }] }, engagement_referrals_proof: { kind: "crm_files" as const, files: [file("ref.jpg")] },
      remark_photos: { kind: "crm_files" as const, files: [file("a.jpg"), file("b.jpg")] }, wedding_month: "february",
      next_visit_date_other: "2026-12-01",
    };
    const display = {
      primary_name: "Asha", primary_phone: "98765 43210", salesperson: "Priya", crm_name: "CRM One", gender: "FEMALE",
      visit_status: "YES", bought_categories: "Rings, Other", bought_other: "Anklet", other_order: "NO", engagement_google_review: "YES", engagement_instagram: "NO",
      engagement_instagram_reason: "No phone", engagement_referrals: "YES", wedding_month: "February",
    };
    const { payload, files } = walkinPayloadFromForm(fieldMap, { answers, display, rowDisplay: { companions: [{ name: "Ravi", mobile: "9000000000", relation: "WIFE" }] } }, context);
    expect(payload).toMatchObject({
      client_id: "c1", entry_queue_id: "q1", branch_id: "b1", client_type: "existing", proposed_client_id: "c1", proposed_timeline_id: "t1",
      primary_name: "Asha", primary_phone: "+919876543210", billing_phone: "+919876543210", salesperson: "Priya", salesperson_id: "s1", crm_name: "CRM One", gender: "FEMALE",
      visit_status: "YES", did_buy: true, other_order: "NO", wedding_month: "2", source_of_lead: "Walk-in",
      bought_categories: ["Rings", "Other"], bought_count: "2", bought_other: "Anklet",
      companions: [{ name: "Ravi", mobile: "9000000000", relation: "WIFE" }], companions_count: "1", referrals_count: "1",
      engagement: { google_review: { asked: true, no_reason: "" }, instagram: { asked: false, no_reason: "No phone" }, referrals: { asked: true, no_reason: "" } },
      category_details: { bought_count: "2", bought_tags: ["R-1", "R-2"], bought_other: "Anklet", seen_tags: [] },
      additional_fields: { visit_status: "YES", engagement_answers: { google_review: "YES", instagram: "NO", referrals: "YES" }, referrals: [{ name: "Meera", mobile: "9111111111" }] },
    });
    expect(payload.event_date).toBe("2026-11-04T11:30:00+05:30");
    expect(payload.next_visit_date).toBe("2026-12-01");
    expect(payload.documents).toEqual([
      { purpose: "google_review", original_file_name: "review.jpg", storage_path: file("review.jpg").path, file_name: "review.jpg", mime_type: "image/jpeg" },
      { purpose: "referrals", original_file_name: "ref.jpg", storage_path: file("ref.jpg").path, file_name: "ref.jpg", mime_type: "image/jpeg" },
      { purpose: "remark_photo_1", original_file_name: "a.jpg", storage_path: file("a.jpg").path, file_name: "a.jpg", mime_type: "image/jpeg" },
      { purpose: "remark_photo_2", original_file_name: "b.jpg", storage_path: file("b.jpg").path, file_name: "b.jpg", mime_type: "image/jpeg" },
    ]);
    expect(files).toHaveLength(4);
    // Every key the standard form sends is present, blank when not asked.
    expect(payload).toMatchObject({ gift: "", remark: "", pincode: "", seen_count: "" });
  });

  it("reads a Not Bought visit's reasons and the repair visit's second products-seen block", () => {
    const answers = { primary_name: "R", primary_phone: "9876543210", visit_status: "repair_placed", repair_or_order_approach: "yes", seen_categories_b: ["rings"], seen_tags_b: { kind: "repeat" as const, count: "NA", rows: [] }, new_things_choice: "buying_new_product", salesperson_handled: "Arun" };
    const display = { primary_name: "R", primary_phone: "9876543210", visit_status: "REPAIR PLACED", repair_or_order_approach: "YES", seen_categories_b: "Rings", new_things_choice: "BUYING NEW PRODUCT", salesperson_handled: "Arun" };
    const { payload } = walkinPayloadFromForm(fieldMap, { answers, display }, context);
    expect(payload).toMatchObject({ visit_status: "REPAIR_PLACED", did_buy: false, repair_or_order_approach: "YES", seen_categories: ["Rings"], seen_count: "NA", new_things_choice: "BUYING_NEW_PRODUCT", salesperson_handled: "Arun" });
  });
});
