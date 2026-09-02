import { useEffect, useState } from "react";

/** Tracks a media query so layout decisions that CSS cannot express — a prop
 *  handed to a third-party widget, for instance — still follow the viewport. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `md` breakpoint, so JS and CSS agree on what "a phone" means. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}
