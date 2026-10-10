import {
  KIARA_KB_MAX_BYTES,
  chunkKnowledgeText,
  docxHtmlToKnowledgeText,
  type HeadingMode,
} from "../../../packages/core/src/assistant/chunking.ts";

/**
 * Knowledge-base ingestion (spec section 10). Runs as the caller: every
 * database call and the file download use the caller's JWT, and the database
 * re-checks `assistant.manage_knowledge` in every RPC. No service role.
 *
 * Flow: read the pending version, download its file, verify size and SHA-256,
 * check the ZIP directory (bomb guard) before parsing, extract with mammoth
 * (images skipped), build knowledge text and chunks with the shared splitter,
 * and store them in one audited RPC. A file that cannot be used marks the
 * version failed with a reason the owner can act on; the previous live version
 * (if any) stays live.
 */

export type RpcError = Readonly<{ code?: string | undefined; message: string }>;
export type RpcResult = Readonly<{ data: unknown; error: RpcError | null }>;

export interface IngestDeps {
  rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult>;
  /** The stored object's bytes, or null when it cannot be read (missing or no access). */
  download(path: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** mammoth's HTML for a .docx (images replaced by empty <img>). Throws when Word content is unreadable. */
  extractHtml(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
  log(entry: Record<string, unknown>): void;
}

/** Total uncompressed size allowed in one .docx (spec 10: ZIP bomb guard). */
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2000;

export type IngestResult = Readonly<{
  status: number;
  body: Readonly<Record<string, unknown>>;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseIngestRequest(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  const versionId = (body as Record<string, unknown>).version_id;
  return keys.length === 1 && typeof versionId === "string" && UUID.test(versionId) ? versionId : null;
}

export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type ZipCheck = Readonly<{ ok: true; entries: number; uncompressed: number }> | Readonly<{ ok: false; reason: string }>;

/**
 * Reads only the ZIP central directory (no decompression): rejects non-ZIP
 * bytes, ZIP64 archives, too many entries, a total uncompressed size over the
 * limit, and archives without a Word document part.
 */
export function inspectDocxZip(bytes: Uint8Array, maxUncompressed = MAX_UNCOMPRESSED_BYTES): ZipCheck {
  const notWord = { ok: false, reason: "This is not a Word .docx file. Save it as .docx in Word and upload again." } as const;
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return notWord;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 22 - 65535); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd === -1) return notWord;
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return { ok: false, reason: "This file uses an unsupported ZIP format. Save it again in Word as .docx." };
  }
  if (entries > MAX_ZIP_ENTRIES) return { ok: false, reason: "This file has too many parts to be a normal Word document." };
  if (directoryOffset + directorySize > eocd) return notWord;
  const decoder = new TextDecoder();
  let offset = directoryOffset;
  let uncompressed = 0;
  let hasDocument = false;
  for (let entry = 0; entry < entries; entry += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) return notWord;
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (size === 0xffffffff) return { ok: false, reason: "This file uses an unsupported ZIP format. Save it again in Word as .docx." };
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === "word/document.xml") hasDocument = true;
    uncompressed += size;
    if (uncompressed > maxUncompressed) {
      return { ok: false, reason: "This file expands to more than 50 MB and was refused. Remove large embedded files and upload again." };
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (!hasDocument) return notWord;
  return { ok: true, entries, uncompressed };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type VersionInfo = Readonly<{ versionId: string; documentId: string; storagePath: string; byteSize: number; sha256: string }>;

function parseVersion(data: unknown): VersionInfo | null {
  if (!isRecord(data)) return null;
  const { version_id: versionId, document_id: documentId, storage_path: storagePath, byte_size: byteSize, sha256 } = data;
  if (typeof versionId !== "string" || typeof documentId !== "string" || typeof storagePath !== "string"
    || typeof byteSize !== "number" || typeof sha256 !== "string") return null;
  return { versionId, documentId, storagePath, byteSize, sha256 };
}

const failure = (status: number, code: string, error: string): IngestResult => ({ status, body: { error, code } });

/** Ingests one pending version. Never throws; every outcome is an HTTP result. */
export async function runIngest(deps: IngestDeps, versionId: string): Promise<IngestResult> {
  const startedAt = Date.now();
  const read = await deps.rpc("get_kiara_version_for_ingest", { p_version_id: versionId });
  if (read.error) {
    if (read.error.code === "42501") {
      return failure(403, "forbidden", read.error.message === "This section is currently unavailable" ? "Ask Kiara is not available right now." : "You do not have access to manage the knowledge base.");
    }
    if (read.error.code === "22023") return failure(409, "not_pending", "This upload was already processed. Refresh the list.");
    return failure(503, "unavailable", "The knowledge base is unavailable right now. Please try again.");
  }
  const version = parseVersion(read.data);
  if (!version) return failure(503, "unavailable", "The knowledge base is unavailable right now. Please try again.");

  const markFailed = async (reason: string): Promise<IngestResult> => {
    const failed = await deps.rpc("fail_kiara_extraction_with_audit", { p_version_id: version.versionId, p_error: reason });
    deps.log({ event: "kiara_ingest_failed", ms: Date.now() - startedAt, recorded: !failed.error });
    return failure(422, "extraction_failed", reason);
  };

  const bytes = await deps.download(version.storagePath);
  if (!bytes) return failure(409, "file_missing", "The uploaded file was not found. Upload it again.");
  if (bytes.length !== version.byteSize || bytes.length > KIARA_KB_MAX_BYTES || (await sha256Hex(bytes)) !== version.sha256) {
    return await markFailed("The stored file does not match the file that was selected (size or checksum). Upload it again.");
  }
  const zip = inspectDocxZip(bytes);
  if (!zip.ok) return await markFailed(zip.reason);

  let html: string;
  const extractStarted = Date.now();
  try {
    html = await deps.extractHtml(bytes);
  } catch {
    return await markFailed("Word could not read this file. Open it in Word, save it as .docx again, and upload it.");
  }
  const extractMs = Date.now() - extractStarted;
  const knowledge = docxHtmlToKnowledgeText(html);
  if (knowledge.wordCount === 0) {
    return await markFailed("No text was found. The document may be scanned pages or pictures. Type it in as an article or upload a text version.");
  }
  const chunked = chunkKnowledgeText(knowledge.text);
  if (!chunked.ok) return await markFailed(chunked.error);

  const stored = await deps.rpc("store_kiara_extraction_with_audit", {
    p_version_id: version.versionId,
    p_extracted_text: knowledge.text,
    p_chunks: chunked.chunks,
    p_word_count: knowledge.wordCount,
    p_image_count: knowledge.imageCount,
  });
  // Shape only: never document text.
  deps.log({ event: "kiara_ingest", ok: !stored.error, ms: Date.now() - startedAt, extract_ms: extractMs, bytes: bytes.length,
    words: knowledge.wordCount, images: knowledge.imageCount, chunks: chunked.chunks.length, heading_mode: knowledge.headingMode });
  if (stored.error) {
    if (stored.error.code === "22023") return failure(409, "not_stored", stored.error.message);
    if (stored.error.code === "42501") return failure(403, "forbidden", "You do not have access to manage the knowledge base.");
    return failure(503, "unavailable", "The text could not be saved. Please try again.");
  }
  return {
    status: 200,
    body: {
      document_id: version.documentId,
      version_id: version.versionId,
      chunk_count: chunked.chunks.length,
      word_count: knowledge.wordCount,
      image_count: knowledge.imageCount,
      heading_mode: knowledge.headingMode satisfies HeadingMode,
    },
  };
}
