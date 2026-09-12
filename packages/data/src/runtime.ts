/**
 * The two places where the data layer touches something a browser provides and
 * React Native does not. Everything else in this package is platform-neutral.
 */

type UuidFactory = () => string;

let uuidFactory: UuidFactory | null = null;

/**
 * Registers the platform's UUID source. The browser needs no call: `crypto`
 * is standard there. Hermes has no `crypto.randomUUID`, so the native app
 * registers `expo-crypto`'s implementation during startup.
 */
export function setUuidFactory(factory: UuidFactory): void {
  uuidFactory = factory;
}

/**
 * The idempotency key that lets a retried mutation be recognised as the same
 * request rather than applied twice. It must be unpredictable, so there is no
 * `Math.random()` fallback: a weak key here would let a replayed write be
 * mistaken for a fresh one.
 */
export function newRequestKey(): string {
  if (uuidFactory) return uuidFactory();
  const platformCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (platformCrypto?.randomUUID) return platformCrypto.randomUUID();
  throw new Error(
    "No UUID source is available. Call setUuidFactory() during startup on a platform without crypto.randomUUID.",
  );
}

/**
 * A file chosen on a platform that has no `File`. A native picker yields a URI
 * and metadata, which the app reads into a `Blob` or `ArrayBuffer` before
 * handing it here, so Storage receives the same kind of body on both clients.
 */
export type UploadableFile = Readonly<{
  name: string;
  size: number;
  type: string;
  body: Blob | ArrayBuffer;
}>;

/** Either a browser `File` or the native equivalent above. */
export type UploadSource = File | UploadableFile;

/**
 * What a validator needs. Checking a name, a size, and a MIME type never
 * requires the bytes, so a caller can screen a picked file before reading it.
 */
export type UploadFileMeta = Readonly<Pick<UploadableFile, "name" | "size" | "type">>;

/** The name, size, and MIME type every validation and audit record needs. */
export function uploadMeta(file: UploadSource): UploadFileMeta {
  return { name: file.name, size: file.size, type: file.type };
}

/** The bytes to hand Supabase Storage. A `File` is already an acceptable body. */
export function uploadBody(file: UploadSource): Blob | ArrayBuffer | File {
  return "body" in file ? file.body : file;
}
