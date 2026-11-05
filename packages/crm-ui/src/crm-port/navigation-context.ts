// crm-port: router state behind the next/navigation shim. Not part of the original source.
import { createContext, useContext } from "react";

export type CrmAppRouter = {
  push: (href: string) => void;
  replace: (href: string) => void;
  refresh: () => void;
  back: () => void;
  forward: () => void;
  prefetch: (href: string) => void;
  /** Starts loading a CRM page's data (and code) before it is opened; a click within a few seconds uses it. */
  preload: (href: string) => void;
};

export type CrmNavigationState = {
  /** The committed app path without the /crm base path, as Next's usePathname() returns it. */
  pathname: string;
  searchParams: URLSearchParams;
  router: CrmAppRouter;
  /** The page being opened (path + search) while its data loads, so tabs can switch at once; null when idle. */
  pendingHref: string | null;
};

export const CrmNavigationContext = createContext<CrmNavigationState | null>(null);

export function useCrmNavigation(): CrmNavigationState {
  const state = useContext(CrmNavigationContext);
  if (!state) throw new Error("CRM navigation is only available inside CrmApp.");
  return state;
}

/** The page being opened (path + search), or null. Safe outside CrmApp (returns null). */
export function usePendingHref(): string | null {
  return useContext(CrmNavigationContext)?.pendingHref ?? null;
}

/** Preloads a CRM page's data, when the CRM router is present. */
export function usePreload(): (href: string) => void {
  const state = useContext(CrmNavigationContext);
  return (href) => state?.router.preload(href);
}
