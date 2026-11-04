import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Sizes a workspace to the room left below it in the window: the visible
 * viewport (it shrinks while a phone keyboard is open) minus the element's
 * offset from the top of the page and the bottom padding of the shell's
 * <main> (the phone navigation bar). It is measured, not a guessed
 * `100vh - N`, so the JewelOS header, Developer Mode, browser zoom and
 * safe areas are all accounted for.
 *
 * `minHeight` keeps a usable workspace on very short windows: the page then
 * scrolls instead of clipping. Pass `enabled: false` (phones, for example)
 * to let the content take its natural height.
 */
export function useFillViewport<T extends HTMLElement>({ enabled = true, minHeight = 360 }: { enabled?: boolean; minHeight?: number } = {}) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  const measure = useCallback(() => {
    const element = ref.current;
    if (!element || !enabled) { setHeight(null); return; }
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const top = element.getBoundingClientRect().top + window.scrollY;
    const main = element.closest("main");
    const bottom = main ? Number.parseFloat(window.getComputedStyle(main).paddingBottom) || 0 : 0;
    const next = Math.max(minHeight, Math.floor(viewport - top - bottom));
    setHeight((current) => current === next ? current : next);
  }, [enabled, minHeight]);
  useLayoutEffect(() => {
    measure();
    if (!enabled) return;
    const viewport = window.visualViewport;
    window.addEventListener("resize", measure);
    viewport?.addEventListener("resize", measure);
    // The header or toolbar above the workspace can change height (wrapping, Developer Mode).
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const header = document.querySelector("body header");
    if (header) observer?.observe(header);
    const previous = ref.current?.previousElementSibling;
    if (previous) observer?.observe(previous);
    return () => {
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [enabled, measure]);
  const style: CSSProperties | undefined = height === null ? undefined : { height };
  return { ref, style, measure };
}
