import { createContext, useContext } from "react";

/* App-wide store. App.jsx owns the state and provides it; every screen reads
   through this hook so swapping the in-memory data for API calls touches
   exactly one file. */

export const Store = createContext(null);

export function useStore() {
  const ctx = useContext(Store);
  if (!ctx) throw new Error("useStore must be used inside <Store.Provider>");
  return ctx;
}
