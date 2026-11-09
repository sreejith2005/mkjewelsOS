import { useMemo } from "react";
import { directorCoveredStoreIds } from "@jewelos/core";
import type { DirectorScope } from "@jewelos/data/users/franchise";

/**
 * "Director" in the System role list. It is the Admin role limited to the
 * franchises and stores chosen here (migration 0397); the server decides.
 */
export const DIRECTOR_CHOICE = "director";
export const EMPTY_DIRECTOR_SCOPE: DirectorScope = { franchiseGroupIds: [], branchIds: [] };

type PickerBranch = Readonly<{ id: string; name: string; is_active: boolean | null; franchise_group_id?: string | null }>;
type PickerFranchise = Readonly<{ id: string; name: string; is_active: boolean }>;

export function directorScopeIsEmpty(scope: DirectorScope): boolean {
  return scope.franchiseGroupIds.length === 0 && scope.branchIds.length === 0;
}

/**
 * Tick whole franchises (every store in them, including stores opened later)
 * and/or single stores. Laid out as one stacked list so it works at phone width.
 */
export function DirectorScopePicker({ branches, franchises, value, onChange, disabled = false }: Readonly<{
  branches: readonly PickerBranch[];
  franchises: readonly PickerFranchise[];
  value: DirectorScope;
  onChange: (next: DirectorScope) => void;
  disabled?: boolean;
}>) {
  const stores = useMemo(() => branches.filter((branch) => branch.is_active !== false), [branches]);
  const groups = useMemo(() => {
    const known = franchises.filter((franchise) => franchise.is_active);
    const knownIds = new Set(known.map((franchise) => franchise.id));
    const byName = (left: PickerBranch, right: PickerBranch) => left.name.localeCompare(right.name);
    const unmapped = stores.filter((store) => !store.franchise_group_id || !knownIds.has(store.franchise_group_id)).sort(byName);
    return [
      ...known.map((franchise) => ({ franchise, stores: stores.filter((store) => store.franchise_group_id === franchise.id).sort(byName) })),
      ...(unmapped.length ? [{ franchise: null, stores: unmapped }] : []),
    ];
  }, [franchises, stores]);
  const covered = directorCoveredStoreIds(stores, value.franchiseGroupIds, value.branchIds);
  const coveredNames = stores.filter((store) => covered.includes(store.id)).map((store) => store.name);

  const toggleFranchise = (franchiseId: string, on: boolean) => {
    const inFranchise = new Set(stores.filter((store) => store.franchise_group_id === franchiseId).map((store) => store.id));
    onChange({
      franchiseGroupIds: on ? [...value.franchiseGroupIds, franchiseId] : value.franchiseGroupIds.filter((id) => id !== franchiseId),
      // A whole franchise already covers its stores.
      branchIds: on ? value.branchIds.filter((id) => !inFranchise.has(id)) : value.branchIds,
    });
  };
  const toggleStore = (storeId: string, on: boolean) => {
    onChange({ ...value, branchIds: on ? [...value.branchIds, storeId] : value.branchIds.filter((id) => id !== storeId) });
  };

  return (
    <fieldset className="min-w-0 sm:col-span-2 lg:col-span-3" disabled={disabled}>
      <legend className="label">Franchises and stores they oversee</legend>
      <p className="mb-2 text-xs text-soft-grey">
        Tick a whole franchise to include every store in it, including stores opened later, or tick single stores. A Director sees and manages only these stores. No department or designation is needed.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {groups.map(({ franchise, stores: groupStores }) => {
          const whole = franchise !== null && value.franchiseGroupIds.includes(franchise.id);
          return (
            <div className="rounded-lg border border-gold/15 p-3" key={franchise?.id ?? "unmapped"}>
              {franchise ? (
                <label className="flex min-h-11 items-center gap-2 font-medium text-task-text">
                  <input checked={whole} className="size-4 accent-gold" onChange={(event) => toggleFranchise(franchise.id, event.target.checked)} type="checkbox" />
                  Whole {franchise.name} franchise
                </label>
              ) : (
                <p className="min-h-11 py-2 text-sm font-medium text-task-text">Stores not in a franchise</p>
              )}
              <ul className="ml-6">
                {groupStores.map((store) => (
                  <li key={store.id}>
                    <label className="flex min-h-10 items-center gap-2 text-sm text-task-text">
                      <input
                        checked={whole || value.branchIds.includes(store.id)}
                        className="size-4 accent-gold"
                        disabled={whole}
                        onChange={(event) => toggleStore(store.id, event.target.checked)}
                        type="checkbox"
                      />
                      {store.name}
                    </label>
                  </li>
                ))}
                {groupStores.length === 0 ? <li className="py-1 text-xs text-soft-grey">No stores yet.</li> : null}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-soft-grey" role="status">
        {covered.length === 0
          ? "Choose at least one franchise or store."
          : `Sees ${covered.length} ${covered.length === 1 ? "store" : "stores"}: ${coveredNames.join(", ")}.`}
      </p>
    </fieldset>
  );
}
