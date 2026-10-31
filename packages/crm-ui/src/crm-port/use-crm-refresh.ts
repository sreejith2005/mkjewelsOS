import { useEffect, useRef } from "react";
import { createRefreshCoordinator } from "@jewelos/core";

/** Catch up the existing CRM loaders; records remain in the CRM project. */
export function useCrmRefresh(refresh: () => Promise<void>) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    const available = () => document.visibilityState === "visible" && navigator.onLine;
    const coordinator = createRefreshCoordinator(async () => {
      if (available()) await latest.current();
    });
    const wake = () => { if (available()) coordinator.request(); };
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    // CRM has no deployed tenant broadcast contract. Bounded polling catches
    // remote commits while this page stays active, without another data store.
    const timer = window.setInterval(wake, 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      coordinator.dispose();
    };
  }, []);
}
