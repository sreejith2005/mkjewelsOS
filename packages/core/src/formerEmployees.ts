export type EmploymentState = Readonly<{
  account_status: string | null;
  working_status: string | null;
}>;

/**
 * A former employee has left the business: the resignation workflow or a
 * roster reconciliation marked the account left. Their profile stays for task,
 * form, CRM and audit history, so directories hide it by default instead of
 * deleting it. Mirrors the sign-in gate, which blocks the same accounts.
 */
export function isFormerEmployee(profile: EmploymentState): boolean {
  return profile.account_status === "left" || profile.working_status === "resigned";
}
