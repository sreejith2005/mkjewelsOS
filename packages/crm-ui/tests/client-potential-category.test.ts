import { describe, expect, it } from "vitest";
import { potentialStarRating, potentialStars } from "@/lib/client-potential";

describe("client potential category stars", () => {
  it.each([
    ["Cold Lead", 1, "★☆☆☆☆"],
    ["Cool Lead", 2, "★★☆☆☆"],
    ["Warm Lead", 3, "★★★☆☆"],
    ["Hot Lead", 4, "★★★★☆"],
    ["VIP Lead", 5, "★★★★★"],
  ] as const)("renders %s as %i stars", (category, rating, stars) => {
    expect(potentialStarRating(category)).toBe(rating);
    expect(potentialStars(category)).toBe(stars);
  });

  it("does not assign stars to an unmatched legacy value", () => {
    expect(potentialStarRating("WhatsApp Broadcast A")).toBeNull();
    expect(potentialStars("WhatsApp Broadcast A")).toBeNull();
  });
});
