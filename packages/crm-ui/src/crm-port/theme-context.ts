// crm-port: the JewelOS light/dark choice, handed in by the host (owner request 2026-10-14: the
// CRM needs the same theme switch as JewelOS). Absent in the Android WebView, which has no
// switch of its own; the CRM then shows no toggle and follows the document theme.
import { createContext, useContext } from "react";

export type CrmTheme = "light" | "dark";
export type CrmThemeControl = Readonly<{ theme: CrmTheme; onThemeChange: (theme: CrmTheme) => void }>;

export const CrmThemeContext = createContext<CrmThemeControl | null>(null);

export function useCrmTheme(): CrmThemeControl | null {
  return useContext(CrmThemeContext);
}
