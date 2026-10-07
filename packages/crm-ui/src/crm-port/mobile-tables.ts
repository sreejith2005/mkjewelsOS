// crm-port: phone layout support (owner request 2026-10-07). Not part of the original source.
//
// On a phone, crm-port/mobile.css shows each row of a wide TABLE element as a card with one
// labelled line per column. The labels come from the element's own column headings: this
// copies each heading into data-label on the cells of that column, and marks the element
// data-crm-cards. The original components are not edited; React leaves these attributes alone
// because it never renders them. Narrow listings (fewer than four columns, e.g. the dashboard
// breakdowns) keep their columns. A row whose cell count does not match the headings (an
// empty-state row with colSpan) is left unlabelled and is shown as a plain block.
//
// Wording note: scripts/build-css.mjs lets Tailwind scan src/, and the bare lower-case word for
// this element (in code or comments) would generate an unused utility class and make the
// committed stylesheet stale. Hence "TABLE" and "listing" below.

/** A listing with fewer columns than this fits a phone as it is. */
export const MIN_CARD_COLUMNS = 4;

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function labelTableCells(root: ParentNode): void {
  for (const listing of Array.from(root.querySelectorAll("TABLE"))) {
    const headings = Array.from(listing.querySelectorAll(":scope > thead > tr:first-child > th")).map((cell) => cell.textContent?.trim() ?? "");
    if (headings.length < MIN_CARD_COLUMNS) {
      if (listing.hasAttribute("data-crm-cards")) listing.removeAttribute("data-crm-cards");
      continue;
    }
    setAttribute(listing, "data-crm-cards", "");
    for (const row of Array.from(listing.querySelectorAll(":scope > tbody > tr"))) {
      const cells = Array.from(row.children);
      if (cells.length !== headings.length) continue;
      cells.forEach((cell, index) => setAttribute(cell, "data-label", headings[index] ?? ""));
    }
  }
}

/** Labels the listings under root now and whenever rows are added or replaced. Returns a stop function. */
export function watchTableCells(root: HTMLElement): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; labelTableCells(root); });
  };
  labelTableCells(root);
  // Attributes are not observed, so the labels this sets never retrigger the observer.
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
  };
}
