/** Keep a selected master/detail record reachable when both columns use page scrolling. */
export function revealPageDetail(element: HTMLElement | null): void {
  if (!element) return;
  const top = element.getBoundingClientRect().top;
  const inset = Number.parseFloat(window.getComputedStyle(element).scrollMarginTop) || 0;
  if (top < inset || top >= window.innerHeight / 2) element.scrollIntoView({ block: "start" });
}
