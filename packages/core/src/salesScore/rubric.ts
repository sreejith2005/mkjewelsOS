import type { SalesRubricDimension } from "./score";

/** MK Sales Score v1. Seeded by migration 0378 (recording_default_rubric_dimensions); rubric.test.ts checks parity. */
export const MK_SALES_RUBRIC_V1: readonly SalesRubricDimension[] = [
  { key: "greeting_sop", label: "Greeting & SOP", weight: 15, description: "Welcome, introduction, hospitality and the MK Jewels opening steps." },
  { key: "product_knowledge", label: "Product Knowledge", weight: 20, description: "Accurate gold, diamond, purity, certification, making-charge and design facts." },
  { key: "needs_discovery", label: "Needs Discovery & Listening", weight: 15, description: "Asks about occasion, budget, preferences and listens before recommending." },
  { key: "objection_handling", label: "Objection Handling", weight: 15, description: "Responds to clear customer resistance. Not applicable when no objection was raised." },
  { key: "pricing_value", label: "Pricing & Value Communication", weight: 10, description: "Explains price, making charges, exchange and value transparently. A price question is not an objection." },
  { key: "closing_follow_up", label: "Closing & Follow-up", weight: 15, description: "Moves toward a decision or agrees a concrete next step." },
  { key: "personalization_empathy", label: "Personalization & Empathy", weight: 10, description: "Adapts to the customer; a different but working style is not a failure." },
];
export const MK_SALES_MIN_ASSESSED_WEIGHT = 50;

/** Same rules as recording_valid_rubric_dimensions in SQL. */
export function validateSalesRubric(dimensions: readonly SalesRubricDimension[]): readonly string[] {
  const errors: string[] = [];
  if (dimensions.length < 1 || dimensions.length > 12) errors.push("dimension_count");
  const keys = new Set<string>();
  let total = 0;
  for (const dimension of dimensions) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(dimension.key)) errors.push(`invalid_key:${dimension.key}`);
    if (keys.has(dimension.key)) errors.push(`duplicate_key:${dimension.key}`);
    keys.add(dimension.key);
    if (dimension.label.length < 1 || dimension.label.length > 80) errors.push(`invalid_label:${dimension.key}`);
    if (!Number.isInteger(dimension.weight) || dimension.weight < 1 || dimension.weight > 100) errors.push(`invalid_weight:${dimension.key}`);
    if (dimension.description !== undefined && dimension.description.length > 500) errors.push(`invalid_description:${dimension.key}`);
    total += dimension.weight;
  }
  if (total !== 100) errors.push("weights_must_total_100");
  return errors;
}
