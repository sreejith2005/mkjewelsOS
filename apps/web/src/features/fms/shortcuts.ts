/** Controls that own their own copy, paste, delete, undo and arrow keys. */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='combobox'], [role='listbox']";

/**
 * True when a key press belongs to the FMS canvas: focus is on the canvas
 * itself or on nothing in particular. Typing in any field, using the
 * inspector, or working in a dialog (the questionnaire editor, a confirmation)
 * keeps the browser's normal behaviour.
 */
export function fmsShortcutContext(target: EventTarget | null, canvas: HTMLElement | null): boolean {
  if (!canvas) return false;
  const element = target instanceof Element ? target : null;
  if (element?.closest(EDITABLE)) return false;
  const dialog = document.querySelector("[aria-modal='true']");
  if (dialog && !dialog.contains(canvas)) return false;
  if (!element || element === document.body || element === document.documentElement) return true;
  return canvas.contains(element);
}
