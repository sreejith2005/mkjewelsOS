/** Sort helpers for the Referrals Calling and Not Bought queues (owner request 2026-10-08). */
export type Compare<T> = (left: T, right: T) => number;

/** ISO date/timestamp order; a missing date always sorts last. */
export function byDate<T>(value: (item: T) => string | null | undefined, direction: "asc" | "desc"): Compare<T> {
  return (left, right) => {
    const a = value(left) || null; const b = value(right) || null;
    if (a === b) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return direction === "asc" ? a.localeCompare(b) : b.localeCompare(a);
  };
}

export function byText<T>(value: (item: T) => string | null | undefined): Compare<T> {
  return (left, right) => (value(left) ?? "").trim().localeCompare((value(right) ?? "").trim(), "en", { sensitivity: "base" });
}

export function byNumberDesc<T>(value: (item: T) => number): Compare<T> {
  return (left, right) => value(right) - value(left);
}

/** Stable sort: equal items keep their incoming order. */
export function sortQueue<T>(items: readonly T[], compare: Compare<T>): T[] {
  return [...items].sort(compare);
}
