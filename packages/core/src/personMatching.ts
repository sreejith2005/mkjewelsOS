/**
 * Resolving a free-text label ("Priya", "priya.nair@…") to exactly one roster
 * member. Extracted from the task bulk-import mapper so that import and the
 * voice task draft resolve people by the same rules; behaviour is unchanged
 * from the import implementation this replaces.
 *
 * Every step demands a *unique* match. An ambiguous label resolves to nobody,
 * because assigning work to the wrong person is worse than asking the author.
 */

export type PersonMatchCandidate = Readonly<{
  id: string;
  employee_name: string;
  email?: string | null;
  aliases?: readonly string[] | null;
}>;

/** Lowercase, trimmed, single-spaced. Idempotent, so pre-normalized input is safe. */
export function normalizePersonLabel(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ");
}

/** "Priya R. Nair" -> "priya nair". Collapses a full name to first + last. */
export function personNameKey(value: string | null | undefined): string {
  const parts = normalizePersonLabel(value).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : parts[0] ?? "";
}

function unique<T>(candidates: readonly T[], predicate: (candidate: T) => boolean): T | undefined {
  const matches = candidates.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Tries, in order: exact email, exact alias, exact full name, then first+last
 * key. Returns undefined when no step produces a single candidate.
 */
export function matchPersonByLabel<T extends PersonMatchCandidate>(
  label: Readonly<{ email?: string | null | undefined; name?: string | null | undefined }>,
  candidates: readonly T[],
): T | undefined {
  const email = normalizePersonLabel(label.email);
  const name = normalizePersonLabel(label.name);
  const emailMatch = email ? unique(candidates, (candidate) => normalizePersonLabel(candidate.email) === email) : undefined;
  if (emailMatch) return emailMatch;
  if (!name) return undefined;
  const aliasMatch = unique(candidates, (candidate) => (candidate.aliases ?? []).some((alias) => normalizePersonLabel(alias) === name));
  if (aliasMatch) return aliasMatch;
  const exactNameMatch = unique(candidates, (candidate) => normalizePersonLabel(candidate.employee_name) === name);
  if (exactNameMatch) return exactNameMatch;
  const compactName = personNameKey(name);
  return compactName ? unique(candidates, (candidate) => personNameKey(candidate.employee_name) === compactName) : undefined;
}
