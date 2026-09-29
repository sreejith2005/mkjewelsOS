export const POTENTIAL_CATEGORIES = [
  "Cold Lead",
  "Cool Lead",
  "Warm Lead",
  "Hot Lead",
  "VIP Lead",
] as const;

export type PotentialCategory = (typeof POTENTIAL_CATEGORIES)[number];

const ratings: Record<PotentialCategory, number> = {
  "Cold Lead": 1,
  "Cool Lead": 2,
  "Warm Lead": 3,
  "Hot Lead": 4,
  "VIP Lead": 5,
};

export function isPotentialCategory(value: string | null | undefined): value is PotentialCategory {
  return POTENTIAL_CATEGORIES.some((category) => category === value);
}

export function potentialStarRating(value: string | null | undefined) {
  return value && isPotentialCategory(value) ? ratings[value] : null;
}

export function potentialStars(value: string | null | undefined) {
  const rating = potentialStarRating(value);
  return rating === null ? null : `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`;
}
