import { startTransition, useCallback, useEffect, useState } from "react";
import { rememberFmsBoardReturn } from "@/features/tasks/fms/boardReturn";

/** Stable navigation keeps host adapters and page loading effects mounted. */
export function usePathname() {
  const [href, setHref] = useState(window.location.href);
  useEffect(() => {
    const restore = () => startTransition(() => setHref(window.location.href));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const navigate = useCallback((nextPath: string) => {
    const nextUrl = new URL(nextPath, window.location.origin);
    const next = `${nextUrl.pathname}${nextUrl.search}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      if (nextUrl.pathname === "/tasks/fms" && window.location.pathname !== "/tasks/fms") rememberFmsBoardReturn(`${window.location.pathname}${window.location.search}`, next);
      window.history.pushState({}, "", next);
    }
    startTransition(() => setHref(nextUrl.href));
  }, []);
  const url = new URL(href, window.location.origin);
  return { navigate, path: url.pathname, search: url.search };
}
