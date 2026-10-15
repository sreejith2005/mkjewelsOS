import { PAGE_IDS, type PageId } from "./roleMenu";
export type SidebarCounts = Partial<Record<PageId, number>>;
export function decodeSidebarCounts(value: unknown): SidebarCounts {
  const counts: SidebarCounts = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return counts;
  for (const page of PAGE_IDS) {
    const count: unknown = Reflect.get(value, page);
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) counts[page] = count;
  }
  return counts;
}
export function sidebarCountLabel(label: string, count: number | undefined): string {
  return count && Number.isSafeInteger(count) && count > 0 ? `${label} (${count})` : label;
}
