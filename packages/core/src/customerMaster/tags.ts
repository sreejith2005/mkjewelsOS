/**
 * Customer categories shown as coloured tags on the customer master list and
 * page. The keys come from customer.client_tags (migration 0428); this is the
 * only place that names them and gives them a colour.
 */

/** A colour family from the JewelOS theme. */
export type CustomerTagTone = "client" | "lead" | "danger" | "warning" | "gold" | "neutral" | "tier_top" | "tier_high" | "tier_mid" | "tier_base";

export type CustomerTag = Readonly<{ key: string; label: string; tone: CustomerTagTone }>;

const TAGS: Record<string, Omit<CustomerTag, "key">> = {
  do_not_contact: { label: "Do not contact", tone: "danger" },
  wrong_number: { label: "Wrong number", tone: "danger" },
  invalid_number: { label: "Invalid number", tone: "warning" },
  abroad: { label: "Abroad", tone: "gold" },
  do_not_call: { label: "Do not call", tone: "danger" },
  not_customer: { label: "Not a customer", tone: "warning" },
  staff: { label: "Staff", tone: "warning" },
  wrong_data: { label: "Wrong data", tone: "danger" },
  referred: { label: "Referred", tone: "neutral" },
};

/**
 * Ticket-size categories from ALL BUYER LIST, highest first (owner, 2026-11-18):
 * ROCKET, DIAMOND, GOLD, SILVER.
 */
export const CUSTOMER_TIERS = ["ROCKET", "DIAMOND", "GOLD", "SILVER"] as const;
const TIER_TONE: Record<(typeof CUSTOMER_TIERS)[number], CustomerTagTone> = {
  ROCKET: "tier_top", DIAMOND: "tier_high", GOLD: "tier_mid", SILVER: "tier_base",
};

/** The tag for one key from the database. Store tags ("store:Bandra") show the store's name; "tier:ROCKET" shows Rocket. */
export function customerTag(key: string): CustomerTag {
  if (key.startsWith("store:")) return { key, label: key.slice("store:".length), tone: "neutral" };
  if (key.startsWith("tier:")) {
    const tier = key.slice("tier:".length).toUpperCase();
    const tone = (CUSTOMER_TIERS as readonly string[]).includes(tier) ? TIER_TONE[tier as (typeof CUSTOMER_TIERS)[number]] : "gold";
    return { key, label: tier.charAt(0) + tier.slice(1).toLowerCase(), tone };
  }
  const known = TAGS[key];
  return known ? { key, ...known } : { key, label: key.replace(/_/g, " "), tone: "neutral" };
}

/** Client or lead first, then the categories in the order the database gives them. */
export function customerTags(segment: string | null | undefined, keys: readonly string[] | null | undefined): CustomerTag[] {
  const type: CustomerTag = segment === "buyer"
    ? { key: "segment", label: "Client", tone: "client" }
    : { key: "segment", label: "Lead", tone: "lead" };
  return [type, ...(keys ?? []).map(customerTag)];
}
