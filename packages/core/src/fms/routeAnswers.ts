import type { FmsBranchRule } from "./types";

/** Keep single-answer routes compatible; multiple choices use existing OR matching. */
export function fmsRouteAnswerSelection(operator: "equals" | "in", answers: readonly string[]): Pick<FmsBranchRule, "operator" | "value"> {
  const values = [...new Set(answers)];
  return operator === "in" || values.length > 1
    ? { operator: "in", value: values }
    : { operator: "equals", value: values[0] ?? "" };
}
