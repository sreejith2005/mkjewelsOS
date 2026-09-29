// crm-port: router state behind the next/navigation shim. Not part of the original source.
import { createContext, useContext } from "react";

export type CrmAppRouter = {
  push: (href: string) => void;
  replace: (href: string) => void;
  refresh: () => void;
  back: () => void;
  forward: () => void;
  prefetch: (href: string) => void;
};

export type CrmNavigationState = {
  /** The committed app path without the /crm base path, as Next's usePathname() returns it. */
  pathname: string;
  searchParams: URLSearchParams;
  router: CrmAppRouter;
};

export const CrmNavigationContext = createContext<CrmNavigationState | null>(null);

export function useCrmNavigation(): CrmNavigationState {
  const state = useContext(CrmNavigationContext);
  if (!state) throw new Error("CRM navigation is only available inside CrmApp.");
  return state;
}
