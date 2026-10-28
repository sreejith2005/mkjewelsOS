import { useEffect } from "react";

/** Inputs that open the on-screen keyboard. Choices and pickers open their own sheet instead. */
const NO_KEYBOARD_INPUTS = new Set(["checkbox", "radio", "file", "button", "submit", "reset", "range", "color", "date", "datetime-local", "time", "month", "week", "hidden"]);

export function opensKeyboard(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return !element.readOnly && !element.disabled;
  if (element instanceof HTMLInputElement) return !element.readOnly && !element.disabled && !NO_KEYBOARD_INPUTS.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable === true;
}

/**
 * Marks `<html data-keyboard="open">` while a phone's keyboard is up, so CSS can
 * stop pinning the Submit bar and bottom navigation over the few lines of screen
 * the keyboard leaves. Focus is used rather than viewport size because Android
 * WebViews resize the whole window, which looks the same as a small phone.
 */
export function useKeyboardOpen(): void {
  useEffect(() => {
    const phone = window.matchMedia?.("(max-width: 767px)");
    const root = document.documentElement;
    const update = () => {
      const open = !!phone?.matches && opensKeyboard(document.activeElement);
      if (open) root.dataset.keyboard = "open"; else delete root.dataset.keyboard;
    };
    // Focus moves between fields without a gap; wait a frame before deciding the keyboard closed.
    let frame = 0;
    const later = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(update); };
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", later);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", later);
      delete root.dataset.keyboard;
    };
  }, []);
}
