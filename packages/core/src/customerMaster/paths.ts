/**
 * Customer master links. These are the only definitions of the addresses of
 * the customer list, a customer's page and an interaction's page, so any
 * section of the app can link to them by the codes people see.
 */
export const CUSTOMER_MASTER_PATH = "/crm/master";

export type CustomerMasterRoute =
  | Readonly<{ view: "list" }>
  | Readonly<{ view: "client"; code: string }>
  | Readonly<{ view: "interaction"; code: string }>
  | Readonly<{ view: "review" }>
  | Readonly<{ view: "table" }>;

/** The review of records that may be the same person (migration 0438). */
export const CUSTOMER_REVIEW_PATH = `${CUSTOMER_MASTER_PATH}/review`;

/** Every field as a column, any filter (migration 0454). */
export const CUSTOMER_TABLE_PATH = `${CUSTOMER_MASTER_PATH}/table`;

const clean = (code: string) => code.trim().toUpperCase();

/** The page of one customer, by MKC code. */
export function customerProfilePath(clientCode: string): string {
  return `${CUSTOMER_MASTER_PATH}/c/${encodeURIComponent(clean(clientCode))}`;
}

/** The page of one interaction, by MKI code. */
export function customerInteractionPath(interactionCode: string): string {
  return `${CUSTOMER_MASTER_PATH}/i/${encodeURIComponent(clean(interactionCode))}`;
}

/** Null when the path is not a customer master address. An unknown sub-path is the list. */
export function parseCustomerMasterPath(path: string): CustomerMasterRoute | null {
  if (path !== CUSTOMER_MASTER_PATH && !path.startsWith(`${CUSTOMER_MASTER_PATH}/`)) return null;
  const [kind, raw] = path.slice(CUSTOMER_MASTER_PATH.length + 1).split("/");
  let code = "";
  try { code = clean(decodeURIComponent(raw ?? "")); } catch { code = ""; }
  if (kind === "c" && /^MKC-\d+$/.test(code)) return { view: "client", code };
  if (kind === "i" && /^MKI-\d+$/.test(code)) return { view: "interaction", code };
  if (kind === "review") return { view: "review" };
  if (kind === "table") return { view: "table" };
  return { view: "list" };
}
