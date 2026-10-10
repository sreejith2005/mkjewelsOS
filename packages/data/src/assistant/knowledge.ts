import { getSupabase as db } from "@jewelos/api-client/client";
import type { Json } from "@jewelos/core";
import {
  KIARA_KB_MAX_BYTES,
  KIARA_KB_MIME,
  chunkKnowledgeText,
  normalizeKnowledgeText,
} from "@jewelos/core";

/**
 * Knowledge-base administration for Super Admin (assistant.manage_knowledge).
 * Every write is an audited RPC; the database re-checks the permission, the
 * tenant, and the file path. Files are never downloaded by the app (v1).
 */

export type KiaraDocumentStatus = "processing" | "active" | "inactive" | "suggested" | "failed" | "deleted";
export type KiaraAudience = "everyone" | "managers_and_above";
export const KIARA_AUDIENCES: readonly KiaraAudience[] = ["everyone", "managers_and_above"];

export type KiaraDocumentSummary = Readonly<{
  id: string;
  title: string;
  category: string | null;
  audience: KiaraAudience;
  source_kind: "upload" | "escalation_answer" | "manual";
  status: KiaraDocumentStatus;
  updated_at: string;
  version_number: number | null;
  word_count: number | null;
  image_count: number | null;
  chunk_count: number;
  original_filename: string | null;
  latest_version: Readonly<{ id: string; version_number: number; extraction_status: "pending" | "succeeded" | "failed"; extraction_error: string | null }> | null;
}>;

export type KiaraDocumentVersion = Readonly<{
  id: string;
  version_number: number;
  source: string;
  original_filename: string | null;
  byte_size: number | null;
  extraction_status: "pending" | "succeeded" | "failed";
  extraction_error: string | null;
  word_count: number | null;
  image_count: number | null;
  chunk_count: number | null;
  created_at: string;
  created_by: string | null;
}>;

export type KiaraDocumentDetail = Readonly<{
  id: string;
  title: string;
  category: string | null;
  audience: KiaraAudience;
  source_kind: KiaraDocumentSummary["source_kind"];
  status: KiaraDocumentStatus;
  updated_at: string;
  updated_by: string | null;
  text: string | null;
  versions: readonly KiaraDocumentVersion[];
  sections: readonly Readonly<{ id: string; ordinal: number; heading_path: string; content: string }>[];
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);

function rpcError(error: { code?: string; message: string; details?: string | null } | null): Error | null {
  if (!error) return null;
  if (error.message === "kiara_duplicate_document") {
    return new Error(`This file is already in the knowledge base as "${error.details ?? "another document"}".`);
  }
  return new Error(error.message || "The knowledge base could not be updated.");
}

/** An RPC result's data, or the RPC's error as a readable Error. */
function unwrap(result: Readonly<{ data: unknown; error: { code?: string; message: string; details?: string | null } | null }>): unknown {
  const failure = rpcError(result.error);
  if (failure) throw failure;
  return result.data;
}

function asSummary(value: unknown): KiaraDocumentSummary | null {
  if (!isRecord(value) || !str(value.id) || !str(value.title) || !str(value.status) || !str(value.updated_at)) return null;
  const latest = isRecord(value.latest_version) && str(value.latest_version.id) ? value.latest_version : null;
  return {
    id: value.id as string,
    title: value.title as string,
    category: str(value.category),
    audience: value.audience === "managers_and_above" ? "managers_and_above" : "everyone",
    source_kind: value.source_kind === "manual" || value.source_kind === "escalation_answer" ? value.source_kind : "upload",
    status: value.status as KiaraDocumentStatus,
    updated_at: value.updated_at as string,
    version_number: num(value.version_number),
    word_count: num(value.word_count),
    image_count: num(value.image_count),
    chunk_count: num(value.chunk_count) ?? 0,
    original_filename: str(value.original_filename),
    latest_version: latest ? {
      id: latest.id as string,
      version_number: num(latest.version_number) ?? 0,
      extraction_status: latest.extraction_status === "succeeded" || latest.extraction_status === "failed" ? latest.extraction_status : "pending",
      extraction_error: str(latest.extraction_error),
    } : null,
  };
}

export async function listKiaraDocuments(search?: string, status?: KiaraDocumentStatus): Promise<KiaraDocumentSummary[]> {
  const data = unwrap(await db().rpc("list_kiara_documents", { ...(search?.trim() ? { p_search: search.trim() } : {}), ...(status ? { p_status: status } : {}) }));
  return (Array.isArray(data) ? data : []).flatMap((row) => {
    const summary = asSummary(row);
    return summary ? [summary] : [];
  });
}

export async function getKiaraDocument(id: string): Promise<KiaraDocumentDetail> {
  const data = unwrap(await db().rpc("get_kiara_document", { p_id: id }));
  const summary = asSummary({ ...(isRecord(data) ? data : {}), chunk_count: 0 });
  if (!summary || !isRecord(data)) throw new Error("This document could not be loaded.");
  return {
    id: summary.id,
    title: summary.title,
    category: summary.category,
    audience: summary.audience,
    source_kind: summary.source_kind,
    status: summary.status,
    updated_at: summary.updated_at,
    updated_by: str(data.updated_by),
    text: str(data.text),
    versions: (Array.isArray(data.versions) ? data.versions : []).flatMap((row): KiaraDocumentVersion[] => {
      if (!isRecord(row) || !str(row.id) || !str(row.created_at)) return [];
      return [{
        id: row.id as string,
        version_number: num(row.version_number) ?? 0,
        source: str(row.source) ?? "docx",
        original_filename: str(row.original_filename),
        byte_size: num(row.byte_size),
        extraction_status: row.extraction_status === "succeeded" || row.extraction_status === "failed" ? row.extraction_status : "pending",
        extraction_error: str(row.extraction_error),
        word_count: num(row.word_count),
        image_count: num(row.image_count),
        chunk_count: num(row.chunk_count),
        created_at: row.created_at as string,
        created_by: str(row.created_by),
      }];
    }),
    sections: (Array.isArray(data.sections) ? data.sections : []).flatMap((row) =>
      isRecord(row) && str(row.id) && str(row.content)
        ? [{ id: row.id as string, ordinal: num(row.ordinal) ?? 0, heading_path: str(row.heading_path) ?? "", content: row.content as string }]
        : []),
  };
}

// ---------------------------------------------------------------------------
// Uploads: register -> upload -> extract, each stage retryable
// ---------------------------------------------------------------------------

export type KiaraUploadStage = "checking" | "registering" | "uploading" | "extracting" | "ready" | "failed";

/** Where a file's upload got to, so "Retry" resumes from the right step. */
export type KiaraUploadState = Readonly<{
  stage: KiaraUploadStage;
  documentId?: string | undefined;
  versionId?: string | undefined;
  storagePath?: string | undefined;
  /** The file reached storage. */
  uploaded?: boolean | undefined;
  /** The version's extraction failed for good; a retry needs a new version. */
  versionFailed?: boolean | undefined;
  error?: string | undefined;
  result?: Readonly<{ chunk_count: number; word_count: number; image_count: number }> | undefined;
}>;

/** Client-side checks before anything is sent (the bucket and RPCs re-check). */
export function knowledgeFileProblem(file: Readonly<{ name: string; size: number }>): string | null {
  if (!/\.docx$/i.test(file.name)) {
    return /\.doc$/i.test(file.name) ? "Old .doc files are not supported. Open it in Word and save as .docx." : "Only Word .docx files can be uploaded.";
  }
  if (file.size < 1) return "This file is empty.";
  if (file.size > KIARA_KB_MAX_BYTES) return "The file is larger than 10 MB. Remove large pictures or split it.";
  return null;
}

export async function sha256OfFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type Registration = Readonly<{ document_id: string; version_id: string; storage_path: string }>;

function asRegistration(value: unknown): Registration {
  if (!isRecord(value) || !str(value.document_id) || !str(value.version_id) || !str(value.storage_path)) throw new Error("The upload could not be registered.");
  return { document_id: value.document_id as string, version_id: value.version_id as string, storage_path: value.storage_path as string };
}

async function invokeIngest(versionId: string): Promise<Readonly<{ ok: true; result: NonNullable<KiaraUploadState["result"]> } | { ok: false; error: string; versionFailed: boolean }>> {
  const { data, error } = await db().functions.invoke("kiara-knowledge-ingest", { method: "POST", body: { version_id: versionId } });
  if (!error && isRecord(data) && typeof data.chunk_count === "number") {
    return { ok: true, result: { chunk_count: data.chunk_count, word_count: num(data.word_count) ?? 0, image_count: num(data.image_count) ?? 0 } };
  }
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const body = await context.clone().json() as { error?: unknown; code?: unknown };
      const message = typeof body.error === "string" ? body.error : "Extraction failed.";
      return { ok: false, error: message, versionFailed: body.code === "extraction_failed" || body.code === "not_pending" };
    } catch {
      // Fall through.
    }
  }
  return { ok: false, error: "Extraction did not finish (connection problem). Retry.", versionFailed: false };
}

export type UploadKnowledgeInput = Readonly<{
  file: File;
  title: string;
  category: string | null;
  audience: KiaraAudience;
  /** Replace: the document receiving a new version. */
  replaceDocumentId?: string | undefined;
}>;

/**
 * Runs (or resumes) one file's upload. Each stage reports through `onState`.
 * Resuming from `previous` skips finished steps: an upload already stored is
 * not sent again, and a version whose extraction failed gets a new version.
 */
export async function uploadKnowledgeDocx(
  input: UploadKnowledgeInput,
  onState: (state: KiaraUploadState) => void,
  previous?: KiaraUploadState,
): Promise<KiaraUploadState> {
  let state: KiaraUploadState = previous && !previous.versionFailed ? { ...previous } : { stage: "checking", documentId: previous?.documentId ?? input.replaceDocumentId };
  const set = (next: KiaraUploadState) => {
    state = next;
    onState(next);
    return next;
  };
  const fail = (error: string, extra: Partial<KiaraUploadState> = {}) => set({ ...state, ...extra, stage: "failed", error });

  const problem = knowledgeFileProblem(input.file);
  if (problem) return fail(problem);
  try {
    if (!state.versionId) {
      set({ ...state, stage: "checking", error: undefined });
      const hash = await sha256OfFile(input.file);
      set({ ...state, stage: "registering" });
      const registration = asRegistration(state.documentId
        ? unwrap(await db().rpc("add_kiara_document_version_with_audit", { p_document_id: state.documentId, p_filename: input.file.name, p_byte_size: input.file.size, p_sha256: hash }))
        : unwrap(await db().rpc("create_kiara_document_with_audit", { p_title: input.title, p_category: input.category as string, p_audience: input.audience, p_filename: input.file.name, p_byte_size: input.file.size, p_sha256: hash })));
      set({ ...state, documentId: registration.document_id, versionId: registration.version_id, storagePath: registration.storage_path, uploaded: false, versionFailed: false });
    }
    if (!state.uploaded) {
      set({ ...state, stage: "uploading", error: undefined });
      const { error } = await db().storage.from("kiara-knowledge").upload(state.storagePath!, input.file, { contentType: KIARA_KB_MIME, upsert: false });
      // A retry after a lost response finds the object already stored.
      if (error && !/already exists|duplicate/i.test(error.message)) return fail(`Upload failed: ${error.message}`);
      set({ ...state, uploaded: true });
    }
    set({ ...state, stage: "extracting", error: undefined });
    const ingest = await invokeIngest(state.versionId!);
    if (!ingest.ok) return fail(ingest.error, { versionFailed: ingest.versionFailed });
    return set({ ...state, stage: "ready", result: ingest.result, error: undefined });
  } catch (caught) {
    return fail(caught instanceof Error && caught.message ? caught.message : "The upload failed.");
  }
}

// ---------------------------------------------------------------------------
// Text, details, status, delete, and a test search
// ---------------------------------------------------------------------------

/**
 * Saves edited text, or a new article when `documentId` is null. The sections
 * come from the same splitter the .docx ingest uses, so what is saved is what
 * Kiara reads; the database checks each section is a slice of the text.
 */
export async function saveKiaraDocumentText(input: Readonly<{ documentId: string | null; title: string; category: string | null; audience: KiaraAudience; text: string }>): Promise<string> {
  const text = normalizeKnowledgeText(input.text);
  const chunked = chunkKnowledgeText(text);
  if (!chunked.ok) throw new Error(chunked.error);
  const data = unwrap(await db().rpc("save_kiara_document_text_with_audit", {
    // Null document id = a new article; null category = none (generated types mark SQL args non-null).
    p_document_id: input.documentId as string,
    p_title: input.title,
    p_category: input.category as string,
    p_audience: input.audience,
    p_text: text,
    p_chunks: chunked.chunks as unknown as Json,
  }));
  if (!isRecord(data) || !str(data.document_id)) throw new Error("The text could not be saved.");
  return data.document_id as string;
}

export async function updateKiaraDocumentDetails(documentId: string, details: Readonly<{ title: string; category: string | null; audience: KiaraAudience }>): Promise<void> {
  unwrap(await db().rpc("update_kiara_document_details_with_audit", { p_document_id: documentId, p_title: details.title, p_category: details.category as string, p_audience: details.audience }));
}

export async function setKiaraDocumentStatus(documentId: string, status: "active" | "inactive"): Promise<void> {
  unwrap(await db().rpc("set_kiara_document_status_with_audit", { p_document_id: documentId, p_status: status }));
}

/** Tombstones the document, then removes its files (allowed only after the tombstone). */
export async function deleteKiaraDocument(documentId: string): Promise<Readonly<{ filesRemoved: boolean }>> {
  const paths = unwrap(await db().rpc("delete_kiara_document_with_audit", { p_document_id: documentId }));
  const list = (Array.isArray(paths) ? paths : []).filter((path): path is string => typeof path === "string");
  if (list.length === 0) return { filesRemoved: true };
  const { error } = await db().storage.from("kiara-knowledge").remove(list);
  return { filesRemoved: !error };
}

export type KiaraSearchHit = Readonly<{ chunk_id: string; document_id: string; title: string; heading_path: string; content: string }>;

/** What Kiara would retrieve for these words (the same RPC and audience rules). */
export async function searchKiaraKnowledge(englishQuery: string, originalTerms?: string): Promise<KiaraSearchHit[]> {
  const data = unwrap(await db().rpc("search_kiara_knowledge", { p_query: englishQuery, ...(originalTerms?.trim() ? { p_original_terms: originalTerms.trim() } : {}), p_limit: 8 }));
  return (isRecord(data) && Array.isArray(data.results) ? data.results : []).flatMap((row): KiaraSearchHit[] =>
    isRecord(row) && str(row.chunk_id) && str(row.document_id) && str(row.title) && str(row.content)
      ? [{ chunk_id: row.chunk_id as string, document_id: row.document_id as string, title: row.title as string, heading_path: str(row.heading_path) ?? "", content: row.content as string }]
      : []);
}
