"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Rarely used page actions (sync, refresh) behind one "⋯" button (owner 2026-11-05: less on screen). */
export function MoreActions({ children, label = "More actions" }: { children: ReactNode; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return <details ref={ref} className="crm-more"><summary aria-label={label} title={label}><span aria-hidden="true">⋯</span></summary><div className="crm-more-menu" onClick={() => { if (ref.current) ref.current.open = false; }}>{children}</div></details>;
}
