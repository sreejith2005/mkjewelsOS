/**
 * Customer categories shown as coloured tags on the customer master list and
 * page. The keys come from customer.client_tags (migration 0428); this is the
 * only place that names them and gives them a colour.
 */

/** A colour family from the JewelOS theme. */
export type CustomerTagTone = "client" | "lead" | "danger" | "warning" | "gold" | "neutral";

export type CustomerTag = Readonly<{ key: string; label: string; tone: CustomerTagTone }>;

const TAGS: Record<string, Omit<CustomerTag, "key">> = {
  abroad: { label: "Abroad", tone: "gold" },
  do_not_call: { label: "Do not call", tone: "danger" },
  not_customer: { label: "Not a customer", tone: "warning" },
  staff: { label: "Staff", tone: "warning" },
  wrong_data: { label: "Wrong data", tone: "danger" },
  referred: { label: "Referred", tone: "neutral" },
};

/** The tag for one key from the database. Store tags ("store:Bandra") show the store's name. */
export function customerTag(key: string): CustomerTag {
  if (key.startsWith("store:")) return { key, label: key.slice("store:".length), tone: "neutral" };
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
