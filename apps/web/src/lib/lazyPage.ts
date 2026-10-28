import { lazy, type ComponentType, type LazyExoticComponent } from "react";

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

export type PreloadablePage<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  /** Downloads the page's code ahead of time; safe to call any number of times. */
  preload: () => Promise<void>;
};

export function lazyPage<T extends ComponentType<any>>(page: string, loader: () => Promise<{ default: T }>): PreloadablePage<T> {
  // One shared download for both the prefetch and the render. A failed
  // download is forgotten so the next attempt (or the render) retries it.
  let pending: Promise<{ default: T }> | null = null;
  const load = () => {
    pending ??= loader().catch((error: unknown) => { pending = null; throw error; });
    return pending;
  };
  const component = lazy(async () => {
    try {
      const module = await load();
      if (typeof window !== "undefined") window.sessionStorage.removeItem(guardKey(page));
      return module;
    } catch (error) {
      recoverFromStaleLazyPageChunk(page, error, () => window.location.reload());
      throw error;
    }
  }) as PreloadablePage<T>;
  // A prefetch failure is not an error the user should see; rendering retries.
  component.preload = () => load().then(() => undefined, () => undefined);
  return component;
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};
type SlowConnection = { saveData?: boolean; effectiveType?: string };

/** True when the device asked to save data or the connection is too slow to prefetch. */
export function shouldSkipPrefetch(connection: SlowConnection | undefined): boolean {
  if (!connection) return false;
  return connection.saveData === true || connection.effectiveType === "slow-2g" || connection.effectiveType === "2g";
}

/**
 * Downloads page code one page at a time while the browser is idle, after the
 * current page has had time to load its own data. Returns a cancel function.
 */
export function prefetchPagesWhenIdle(preloads: readonly (() => Promise<void>)[], startDelayMs = 1500): () => void {
  if (typeof window === "undefined" || !preloads.length) return () => undefined;
  const connection = (navigator as Navigator & { connection?: SlowConnection }).connection;
  if (shouldSkipPrefetch(connection)) return () => undefined;
  const idleWindow = window as IdleWindow;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let idleHandle: number | undefined;
  const queue = [...preloads];
  const next = () => {
    if (cancelled) return;
    const preload = queue.shift();
    if (!preload) return;
    const run = () => { if (!cancelled) void preload().then(next); };
    if (idleWindow.requestIdleCallback) idleHandle = idleWindow.requestIdleCallback(run, { timeout: 3000 });
    else timer = setTimeout(run, 50);
  };
  timer = setTimeout(next, startDelayMs);
  return () => {
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    if (idleHandle !== undefined) idleWindow.cancelIdleCallback?.(idleHandle);
  };
}
