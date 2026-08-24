import { lazy, type ComponentType } from "react";

const RELOAD_GUARD_PREFIX = "jewelos:lazy-page-reload:";
const STALE_CHUNK_PATTERNS = [
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "loading chunk",
  "chunkloaderror",
] as const;

const guardKey = (page: string) => `${RELOAD_GUARD_PREFIX}${page}`;

function isStaleLazyPageChunk(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return STALE_CHUNK_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function recoverFromStaleLazyPageChunk(page: string, error: unknown, reload: () => void): boolean {
  if (typeof window === "undefined" || !isStaleLazyPageChunk(error)) return false;
  const key = guardKey(page);
  if (window.sessionStorage.getItem(key) === "attempted") return false;
  window.sessionStorage.setItem(key, "attempted");
  reload();
  return true;
}

export function lazyPage<T extends ComponentType<any>>(page: string, loader: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const module = await loader();
      if (typeof window !== "undefined") window.sessionStorage.removeItem(guardKey(page));
      return module;
    } catch (error) {
      recoverFromStaleLazyPageChunk(page, error, () => window.location.reload());
      throw error;
    }
  });
}
