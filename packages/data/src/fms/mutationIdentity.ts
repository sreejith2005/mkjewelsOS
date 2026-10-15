import { newRequestKey } from "../runtime";

export type FmsMutationStorage = Readonly<{ getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void; removeItem(key: string): Promise<void> | void }>;
const operations = new WeakMap<FmsMutationStorage, Map<string, Promise<string>>>();
let platformStorage: FmsMutationStorage | null = null;
const browserStorage: FmsMutationStorage = {
  getItem: key => globalThis.sessionStorage.getItem(key),
  setItem: (key, value) => globalThis.sessionStorage.setItem(key, value),
  removeItem: key => globalThis.sessionStorage.removeItem(key),
};
export function setFmsMutationStorage(storage: FmsMutationStorage): void { platformStorage = storage; }
export function getFmsMutationStorage(): FmsMutationStorage { return platformStorage ?? browserStorage; }
const storageKey = (user: string, kind: string, target: string) => `jewelos:fms:request:${encodeURIComponent(user)}:${encodeURIComponent(kind)}:${encodeURIComponent(target)}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readIdentity(raw: string): { key: string; complete: boolean } {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("key" in value) || typeof value.key !== "string" || !uuid.test(value.key) || !("complete" in value) || typeof value.complete !== "boolean") throw new Error("Stored workflow retry identity is invalid. Recover the previous submission before starting again.");
  return { key: value.key, complete: value.complete };
}
export async function getFmsMutationIdentity(storage: FmsMutationStorage, user: string, kind: string, target: string): Promise<string> {
  const key = storageKey(user, kind, target);
  let pending = operations.get(storage);
  if (!pending) { pending = new Map(); operations.set(storage, pending); }
  const current = pending.get(key);
  if (current) return current;
  // This mutex coordinates metadata writes only; durable work lives in Postgres.
  const operation = (async () => {
    const raw = await storage.getItem(key);
    if (raw) return readIdentity(raw).key;
    const requestKey = newRequestKey();
    await storage.setItem(key, JSON.stringify({ key: requestKey, complete: false }));
    return requestKey;
  })();
  pending.set(key, operation);
  try { return await operation; } finally { pending.delete(key); }
}
export async function markFmsMutationComplete(storage: FmsMutationStorage, user: string, kind: string, target: string): Promise<void> {
  const key = await getFmsMutationIdentity(storage, user, kind, target);
  await storage.setItem(storageKey(user, kind, target), JSON.stringify({ key, complete: true }));
}
export async function beginNewFmsMutation(storage: FmsMutationStorage, user: string, kind: string, target: string): Promise<void> {
  const key = storageKey(user, kind, target);
  const raw = await storage.getItem(key);
  if (raw && !readIdentity(raw).complete) throw new Error("Recover the previous workflow submission before starting another.");
  await storage.removeItem(key);
}
