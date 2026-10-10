import { assert, assertEquals } from "@std/assert";
import { Buffer } from "node:buffer";
import JSZip from "jszip";
import mammoth from "mammoth";
import { inspectDocxZip, parseIngestRequest, runIngest, sha256Hex, type IngestDeps, type RpcResult } from "./worker.ts";

// Synthetic documents only, built at test time: no real SOP content in Git.
const VERSION = "11111111-2222-4333-8444-555555555555";
const DOCUMENT = "66666666-7777-4888-9999-000000000000";

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const paragraph = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const documentXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

async function docx(body: string, extra: Record<string, Uint8Array | string> = {}): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file("word/document.xml", documentXml(body));
  for (const [name, value] of Object.entries(extra)) zip.file(name, value);
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

const SAMPLE_BODY = paragraph("Synthetic opening procedure", "Heading1") + paragraph("Unlock the front door at ten.")
  + paragraph("Closing", "Heading2") + paragraph("Count the trays and lock the safe.");

type Call = Readonly<{ fn: string; args: Record<string, unknown> }>;

function fakeDeps(bytes: Uint8Array<ArrayBuffer> | null, declared: Readonly<{ size?: number; sha?: string }> = {}, overrides: Partial<IngestDeps> = {}) {
  const calls: Call[] = [];
  let extracted = 0;
  const deps: IngestDeps = {
    rpc: async (fn, args): Promise<RpcResult> => {
      calls.push({ fn, args });
      if (fn === "get_kiara_version_for_ingest") {
        return {
          data: { version_id: VERSION, document_id: DOCUMENT, storage_path: "t/d/v.docx", byte_size: declared.size ?? bytes?.length ?? 1, sha256: declared.sha ?? (bytes ? await sha256Hex(bytes) : "0".repeat(64)) },
          error: null,
        };
      }
      return { data: fn === "store_kiara_extraction_with_audit" ? { chunk_count: (args.p_chunks as unknown[]).length } : null, error: null };
    },
    download: async () => bytes,
    extractHtml: async (input) => {
      extracted += 1;
      return (await mammoth.convertToHtml({ buffer: Buffer.from(input.buffer, input.byteOffset, input.byteLength) }, { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: "" })) })).value;
    },
    log: () => {},
    ...overrides,
  };
  return { deps, calls, extractedCount: () => extracted };
}

const failedWith = (calls: readonly Call[]) => calls.find((call) => call.fn === "fail_kiara_extraction_with_audit")?.args.p_error as string | undefined;

Deno.test("a synthetic .docx is extracted, chunked as verbatim slices, and stored", async () => {
  const bytes = await docx(SAMPLE_BODY);
  const { deps, calls } = fakeDeps(bytes);
  const result = await runIngest(deps, VERSION);
  assertEquals(result.status, 200);
  const stored = calls.find((call) => call.fn === "store_kiara_extraction_with_audit")!;
  const text = stored.args.p_extracted_text as string;
  assertEquals(text, "# Synthetic opening procedure\n\nUnlock the front door at ten.\n\n## Closing\n\nCount the trays and lock the safe.");
  const chunks = stored.args.p_chunks as Array<{ heading_path: string; content: string }>;
  assert(chunks.length >= 1 && chunks.every((chunk) => text.includes(chunk.content)));
  assertEquals(result.body.heading_mode, "styles");
  assertEquals(failedWith(calls), undefined);
});

Deno.test("a ZIP bomb is refused from the central directory before extraction", async () => {
  const bytes = await docx(SAMPLE_BODY, { "word/media/zeros.bin": new Uint8Array(51 * 1024 * 1024) });
  assert(bytes.length < 1024 * 1024, "the bomb is small on disk");
  const check = inspectDocxZip(bytes);
  assertEquals(check.ok, false);
  const { deps, calls, extractedCount } = fakeDeps(bytes);
  const result = await runIngest(deps, VERSION);
  assertEquals(result.status, 422);
  assert(failedWith(calls)?.includes("50 MB"));
  assertEquals(extractedCount(), 0);
});

Deno.test("a SHA-256 or size mismatch fails the version without extracting", async () => {
  const bytes = await docx(SAMPLE_BODY);
  for (const declared of [{ sha: "a".repeat(64) }, { size: bytes.length + 1 }]) {
    const { deps, calls, extractedCount } = fakeDeps(bytes, declared);
    const result = await runIngest(deps, VERSION);
    assertEquals(result.status, 422);
    assert(failedWith(calls)?.includes("does not match"));
    assertEquals(extractedCount(), 0);
    assert(!calls.some((call) => call.fn === "store_kiara_extraction_with_audit"));
  }
});

Deno.test("non-docx bytes and a ZIP without a Word document are refused", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 synthetic not a word file");
  const zip = new JSZip();
  zip.file("readme.txt", "synthetic");
  const plainZip = new Uint8Array(await zip.generateAsync({ type: "uint8array" }));
  for (const bytes of [pdf, plainZip]) {
    const { deps, calls, extractedCount } = fakeDeps(bytes);
    const result = await runIngest(deps, VERSION);
    assertEquals(result.status, 422);
    assert(failedWith(calls)?.includes("not a Word .docx file"));
    assertEquals(extractedCount(), 0);
  }
});

Deno.test("an extraction failure marks the version failed with an actionable reason", async () => {
  const bytes = await docx(SAMPLE_BODY);
  const { deps, calls } = fakeDeps(bytes, {}, { extractHtml: () => Promise.reject(new Error("corrupt")) });
  const result = await runIngest(deps, VERSION);
  assertEquals(result.status, 422);
  assert(failedWith(calls)?.includes("Word could not read this file"));
});

Deno.test("a document with no text (pictures only) is refused", async () => {
  const bytes = await docx(paragraph(" "));
  const { deps, calls } = fakeDeps(bytes, {}, { extractHtml: () => Promise.resolve("<p><img src=\"\" /></p>") });
  const result = await runIngest(deps, VERSION);
  assertEquals(result.status, 422);
  assert(failedWith(calls)?.includes("No text was found"));
});

Deno.test("chunk limits: too many sections and over-long text are refused", async () => {
  const bytes = await docx(SAMPLE_BODY);
  const manySections = Array.from({ length: 3100 }, (_, index) => `<h1>Section ${index}</h1><p>Body ${index}.</p>`).join("");
  const tooLong = `<p>${"word ".repeat(110_000)}</p>`;
  for (const [html, expected] of [[manySections, "too long"], [tooLong, "500,000"]] as const) {
    const { deps, calls } = fakeDeps(bytes, {}, { extractHtml: () => Promise.resolve(html) });
    const result = await runIngest(deps, VERSION);
    assertEquals(result.status, 422);
    assert(failedWith(calls)?.includes(expected), failedWith(calls));
  }
});

Deno.test("access, state, and download problems are reported without failing the version", async () => {
  const denied = fakeDeps(null, {}, { rpc: () => Promise.resolve({ data: null, error: { code: "42501", message: "Knowledge base management requires permission" } }) });
  assertEquals((await runIngest(denied.deps, VERSION)).status, 403);
  const done = fakeDeps(null, {}, { rpc: () => Promise.resolve({ data: null, error: { code: "22023", message: "This version is not waiting for extraction" } }) });
  assertEquals((await runIngest(done.deps, VERSION)).status, 409);
  const missing = fakeDeps(null);
  const result = await runIngest(missing.deps, VERSION);
  assertEquals(result.status, 409);
  assertEquals(failedWith(missing.calls), undefined);
});

Deno.test("the request body must be exactly a version id", () => {
  assertEquals(parseIngestRequest({ version_id: VERSION }), VERSION);
  assertEquals(parseIngestRequest({ version_id: VERSION, extra: 1 }), null);
  assertEquals(parseIngestRequest({ version_id: "nope" }), null);
  assertEquals(parseIngestRequest([VERSION]), null);
});
