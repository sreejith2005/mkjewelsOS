import { createRefreshCoordinator } from "@jewelos/core";

/** No record cache: suspended screens catch up through their normal loader. */
export function createRefreshLifecycle(refresh: () => Promise<void> | void, initiallyActive: boolean, debounceMs = 350) {
  let active = initiallyActive;
  let disposed = false;
  const coordinator = createRefreshCoordinator(() => {
    if (active && !disposed) return refresh();
  }, debounceMs);
  return {
    request: () => { if (active && !disposed) coordinator.request(); },
    setActive: (next: boolean) => {
      if (disposed || next === active) return;
      active = next;
      if (active) coordinator.request();
    },
    dispose: () => { disposed = true; coordinator.dispose(); },
  };
}
