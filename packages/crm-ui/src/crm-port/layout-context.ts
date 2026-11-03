// crm-port: how the host places the CRM (owner request 2026-11-03: CRM is an ordinary JewelOS
// section). "section" renders inside the JewelOS application shell, which owns the header,
// sidebar, theme switch and sign-out, so the CRM shows only its own section tabs. "standalone"
// keeps the original CRM header and drawer for the embedded root (EmbeddedCrmRoot).
import { createContext, useContext } from "react";

export type CrmLayout = "standalone" | "section";

export const CrmLayoutContext = createContext<CrmLayout>("standalone");

export function useCrmLayout(): CrmLayout {
  return useContext(CrmLayoutContext);
}
