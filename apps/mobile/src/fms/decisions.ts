export type RuntimeDecisionOption = Readonly<{ key: string; label: string }>;

/**
 * The decision choices a step offers, read from its saved timing rule.
 *
 * The options are configuration, never code: a step that offers "Bought",
 * "Did not buy", and "Will decide later" produces three buttons because those
 * three are stored on the stage, and adding a fourth in the FMS Builder makes a
 * fourth button appear without a release. A legacy step that only recorded
 * `decisionMode: "yes_no"` still gets its original Yes and No.
 *
 * This mirrors `runtimeDecisionOptions` in the web stage runner exactly; both
 * read the same `planned_time_rule` column.
 */
export function runtimeDecisionOptions(plannedRule: Record<string, unknown>): readonly RuntimeDecisionOption[] {
  const configured = plannedRule.decisionOptions;
  if (Array.isArray(configured)) {
    return configured.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const { key, label } = item as Record<string, unknown>;
      return typeof key === "string" && key && typeof label === "string" && label.trim()
        ? [{ key, label: label.trim() }]
        : [];
    });
  }
  return plannedRule.decisionMode === "yes_no"
    ? [
        { key: "yes", label: "Yes" },
        { key: "no", label: "No" },
      ]
    : [];
}
