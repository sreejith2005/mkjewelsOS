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

/** A last column with this heading holds the row's buttons and links. */
const ACTIONS_HEADING = /^actions?$/i;

function setAttribute(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

export function labelTableCells(root: ParentNode): void {
  for (const listing of Array.from(root.querySelectorAll("TABLE"))) {
    const headings = Array.from(listing.querySelectorAll(":scope > thead > tr:first-child > th")).map((cell) => cell.textContent?.trim() ?? "");
    if (headings.length < MIN_CARD_COLUMNS) {
      if (listing.hasAttribute("data-crm-cards")) listing.removeAttribute("data-crm-cards");
      if (listing.hasAttribute("data-crm-actions")) listing.removeAttribute("data-crm-actions");
      continue;
    }
    setAttribute(listing, "data-crm-cards", "");
    // crm-port/wide.css pins an actions column to the right edge on tablets and desktops.
    if (ACTIONS_HEADING.test(headings[headings.length - 1] ?? "")) setAttribute(listing, "data-crm-actions", "");
    else if (listing.hasAttribute("data-crm-actions")) listing.removeAttribute("data-crm-actions");
    for (const row of Array.from(listing.querySelectorAll(":scope > tbody > tr"))) {
      const cells = Array.from(row.children);
      if (cells.length !== headings.length) continue;
      cells.forEach((cell, index) => setAttribute(cell, "data-label", headings[index] ?? ""));
    }
  }
}

/** crm-port/wide.css applies from this width; phones keep the card layout and the page scroll. */
export const WIDE_QUERY = "(min-width: 768px)";
/** A fitted listing box is never shorter than this; with less room the page scrolls instead. */
export const MIN_FIT_HEIGHT = 240;
export const FIT_HEIGHT_PROPERTY = "--crm-fit-height";
/** The window size-change event, spelt in two parts so the stylesheet scan (see the wording note above) does not add a utility class. */
const WINDOW_SIZE_EVENT = ["re", "size"].join("");

/**
 * One scroll bar (owner request 2026-10-08: "I don't like the two scroll bars"). On a tablet or
 * desktop, a page with a single wide listing gets that listing's box sized to the room left in
 * the window under everything above it, so the page itself no longer scrolls: the listing is the
 * one scroller, its sideways bar and column headings stay on screen. A page with several
 * listings, or too little room, gets no fitted height; wide.css then lets the box take its full
 * length and only the page scrolls.
 */
export function fitListingHeights(root: ParentNode, view: Window = window): void {
  const boxes = Array.from(root.querySelectorAll("TABLE[data-crm-cards]"))
    .map((listing) => listing.parentElement)
    .filter((box): box is HTMLElement => box instanceof HTMLElement && /(^|\s)overflow-x-auto(\s|$)/.test(box.className));
  const fitted = boxes.length === 1 && view.matchMedia(WIDE_QUERY).matches ? boxes[0]! : null;
  for (const box of boxes) if (box !== fitted && box.style.getPropertyValue(FIT_HEIGHT_PROPERTY)) box.style.removeProperty(FIT_HEIGHT_PROPERTY);
  if (!fitted) return;
  const boxRect = fitted.getBoundingClientRect();
  const page = fitted.closest("main") ?? fitted;
  // Room under the box inside the page (its padding and anything after it), independent of the box height.
  const below = Math.max(0, page.getBoundingClientRect().bottom - boxRect.bottom);
  const top = boxRect.top + view.scrollY;
  const room = Math.floor(view.innerHeight - top - below);
  const value = room >= MIN_FIT_HEIGHT ? `${room}px` : "";
  if (fitted.style.getPropertyValue(FIT_HEIGHT_PROPERTY) === value) return;
  if (value) fitted.style.setProperty(FIT_HEIGHT_PROPERTY, value);
  else fitted.style.removeProperty(FIT_HEIGHT_PROPERTY);
}

/** Labels the listings under root now and whenever rows are added or replaced. Returns a stop function. */
export function watchTableCells(root: HTMLElement): () => void {
  let frame = 0;
  const update = () => { labelTableCells(root); fitListingHeights(root); };
  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => { frame = 0; update(); });
  };
  update();
  // Attributes are not observed, so the labels and heights this sets never retrigger the observer.
  const observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  window.addEventListener(WINDOW_SIZE_EVENT, schedule);
  return () => {
    observer.disconnect();
    window.removeEventListener(WINDOW_SIZE_EVENT, schedule);
    if (frame) window.cancelAnimationFrame(frame);
  };
}
