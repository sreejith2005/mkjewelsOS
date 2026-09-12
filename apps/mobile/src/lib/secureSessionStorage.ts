import * as SecureStore from "expo-secure-store";
import type { JewelosSessionStorage } from "@jewelos/api-client/client";

/**
 * Android's keystore-backed storage rejects values much beyond 2 KB, and a
 * Supabase session (access token, refresh token, and the user record) routinely
 * exceeds that. The session is therefore split across numbered entries, with a
 * header entry recording how many there are.
 *
 * Everything stays inside SecureStore: no part of a token is written to
 * AsyncStorage, which is world-readable to anything that can reach the app's
 * sandbox on a rooted device.
 */
const CHUNK_SIZE = 1800;
const chunkKey = (key: string, index: number) => `${key}.${index}`;
const countKey = (key: string) => `${key}.count`;

/** SecureStore keys allow only alphanumerics, ".", "-", and "_". */
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

async function readCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  const count = raw === null ? 0 : Number.parseInt(raw, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

async function clear(key: string, count: number): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(countKey(key)),
    ...Array.from({ length: count }, (_unused, index) => SecureStore.deleteItemAsync(chunkKey(key, index))),
  ]);
}

export const secureSessionStorage: JewelosSessionStorage = {
  async getItem(rawKey) {
    const key = safeKey(rawKey);
    const count = await readCount(key);
    if (count === 0) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_unused, index) => SecureStore.getItemAsync(chunkKey(key, index))),
    );
    // A partially written or partially evicted session is not a session. Drop
    // it rather than hand Supabase a truncated token it would fail to parse.
    if (parts.some((part) => part === null)) {
      await clear(key, count);
      return null;
    }
    return parts.join("");
  },

  async setItem(rawKey, value) {
    const key = safeKey(rawKey);
    const previousCount = await readCount(key);
    const chunks: string[] = [];
    for (let index = 0; index < value.length; index += CHUNK_SIZE) {
      chunks.push(value.slice(index, index + CHUNK_SIZE));
    }
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk)));
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
    // A shorter session leaves stale trailing entries behind; remove them so a
    // later read cannot splice fragments of two different sessions together.
    await Promise.all(
      Array.from({ length: Math.max(0, previousCount - chunks.length) }, (_unused, offset) =>
        SecureStore.deleteItemAsync(chunkKey(key, chunks.length + offset)),
      ),
    );
  },

  async removeItem(rawKey) {
    const key = safeKey(rawKey);
    await clear(key, await readCount(key));
  },
};
