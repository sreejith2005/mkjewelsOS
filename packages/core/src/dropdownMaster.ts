/**
 * Dropdown Master's two display decisions: which items a category shows, and
 * the three counts above them.
 *
 * They live here because both clients draw the same tiles, and the counts are
 * not the symmetrical thing they look like — see `dropdownMasterCounts`.
 */

export type DropdownMasterItemLike = Readonly<{
  master_type: string;
  label: string;
  value: string;
  is_active?: boolean | null;
}>;

export type DropdownMasterStatusFilter = "all" | "active" | "inactive";

/**
 * An item counts as active unless it is explicitly inactive. A null
 * `is_active` — a row written before the column existed — is treated as
 * active, which is what the database's own default does.
 */
export const isDropdownMasterItemActive = (item: DropdownMasterItemLike): boolean => item.is_active !== false;

/** The rows one category shows for a given status filter and search term. */
export function filterDropdownMasterItems(
  items: readonly DropdownMasterItemLike[],
  category: string,
  status: DropdownMasterStatusFilter,
  search: string,
): readonly DropdownMasterItemLike[] {
  const needle = search.trim().toLowerCase();
  return items.filter(
    (item) =>
      item.master_type === category &&
      (status === "all" || (status === "active") === isDropdownMasterItemActive(item)) &&
      `${item.label} ${item.value} ${item.master_type}`.toLowerCase().includes(needle),
  );
}

export type DropdownMasterCounts = Readonly<{ total: number; active: number; inactive: number }>;

/**
 * The Total / Active / Inactive tiles.
 *
 * These are deliberately not three slices of one set, because the approved web
 * page does not treat them as such: **Total** and **Inactive** count the whole
 * category and ignore the search box and the status filter, while **Active**
 * counts only what is currently visible. So a search that matches nothing
 * leaves Total and Inactive standing and drops Active to zero.
 *
 * That asymmetry is reproduced here rather than corrected. It is the approved
 * product's behaviour, and web and mobile agreeing matters more than the tiles
 * summing; changing it is a product decision, not a porting one.
 */
export function dropdownMasterCounts(
  items: readonly DropdownMasterItemLike[],
  category: string,
  visibleItems: readonly DropdownMasterItemLike[],
): DropdownMasterCounts {
  const inCategory = items.filter((item) => item.master_type === category);
  return {
    total: inCategory.length,
    active: visibleItems.filter(isDropdownMasterItemActive).length,
    inactive: inCategory.filter((item) => item.is_active === false).length,
  };
}
