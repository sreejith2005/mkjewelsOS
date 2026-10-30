import type { FmsRecordedOutcome } from "@jewelos/core";

/** One semantic token per End Node outcome, shared by the canvas, the inspector and the workspace. */
export const FMS_OUTCOME_STYLE: Readonly<Record<FmsRecordedOutcome, string>> = {
  won: "border-success/50 bg-success/10 text-success",
  lost: "border-danger/50 bg-danger/10 text-danger",
  do_not_contact: "border-warning/50 bg-warning/10 text-warning",
  other: "border-champagne/40 bg-champagne/10 text-champagne",
  unspecified: "border-soft-grey/40 bg-charcoal text-soft-grey",
};
