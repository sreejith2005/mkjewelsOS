import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * The height from an element's top edge to the bottom of the window, kept
 * current as the window resizes. It measures where the application header,
 * developer bar and page padding actually put the element instead of
 * hard-coding their heights, so a full-height workspace neither leaves a gap
 * nor pushes the page into a second scrollbar.
 */
export function useFillViewportHeight(ref: RefObject<HTMLElement | null>, enabled = true, minimum = 320): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!enabled || !element) { setHeight(undefined); return; }
    const measure = () => {
      const top = element.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(minimum, Math.floor(window.innerHeight - top)));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("orientationchange", measure); };
  }, [enabled, minimum, ref]);
  return height;
}
