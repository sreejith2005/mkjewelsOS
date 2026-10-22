import { describe, expect, it } from "vitest";
import { planTaskImportFrequency } from "./frequency";

/**
 * Import replay safety.
 *
 * `task_import_business_fingerprint` hashes each row's `schedule_kind`,
 * `recurrence_rule` and `starts_on`. If a label that imported yesterday
 * produced a different rule today, replaying the same workbook would no longer
 * match its earlier rows and would create duplicate schedules. This snapshot
 * was recorded from the mapper before the shared schedule builder existed; any
 * change to it must be deliberate.
 */
const LEGACY_LABELS = [
  "", "13th Monthly", "1st Monthly", "1st Week Monthly", "2Ã\u0097 Daily", "2x Daily", "2× Daily", "3Ã\u0097 Daily", "3x Daily",
  "7th Monthly", "After Customer Visit", "After Event", "After Serving", "After Shoot", "After Visit", "Annual", "Yearly",
  "As Applicable", "As Assigned", "As Required", "As Required/Ongoing", "As Scheduled", "Campaign-Based", "Daily",
  "Daily / As Required", "Daily â\u0080\u0093 Closing", "Daily â\u0080\u0093 Morning", "Daily â\u0080\u0093 Opening",
  "Daily â\u0080\u0093 T-1", "Daily/As Assigned", "Daily/As Posted", "Daily/As Required", "Daily/As Scheduled", "Daily/Monthly",
  "Daily/Ongoing", "Daily/Per Refill", "Daily/Weekly", "Every 15 Days", "Every Monday", "Monday & Thursday",
  "Monday & Thursday/As Required", "Monthly", "Monthly / As Required", "Monthly â\u0080\u0093 1st to 5th", "Monthly/As Required",
  "Monthly/As Scheduled", "Morning & Closing", "Morning & Evening", "Ongoing", "Per Bag", "Per CAM Piece", "Per Call", "Per Customer",
  "Per Customer/As Applicable", "Per Enquiry", "Per Follow-Up", "Per Interaction", "Per Issue", "Per Job", "Per Lead", "Per Lost Lead",
  "Per Movement", "Per Not-Bought Customer", "Per Parcel", "Per Piece/Batch", "Per Product", "Per Prospect", "Per Receipt",
  "Per Refill", "Per Video Call", "Per Visit", "Shoot Days", "Sunday", "Throughout Day", "Weekly", "Weekly/As Required",
  "Weekly/As Scheduled", "Once", "One Time", "Quarterly",
] as const;

const START_DATES = ["2026-09-22", "2026-01-31", "2027-02-28"] as const;

describe("legacy import frequency labels", () => {
  it("still produce byte-identical plans", () => {
    const plans = Object.fromEntries(
      LEGACY_LABELS.flatMap((label) => START_DATES.map((start) => [`${label} @ ${start}`, planTaskImportFrequency(label, start, "Task")])),
    );
    expect(plans).toMatchSnapshot();
  });
});
