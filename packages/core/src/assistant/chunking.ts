/**
 * Knowledge-base text and chunking (spec section 10).
 *
 * One splitter serves every way text enters the knowledge base:
 * 1. `docxHtmlToKnowledgeText` turns mammoth's HTML for an uploaded .docx into
 *    plain "knowledge text": `#`/`##`/`###` heading lines, paragraphs, `- ` list
 *    lines, and table rows as `cell | cell | cell` lines. Images are dropped.
 * 2. `chunkKnowledgeText` splits knowledge text into chunks by heading. Edited
 *    text and typed articles use it directly, so the owner edits exactly what
 *    Kiara reads.
 *
 * Every chunk's content is a verbatim slice of the text; the database checks
 * that (`kiara_kb_assert_chunks`). Pure: no I/O, no DOM, runs in Deno and the
 * browser.
 */

export const KIARA_KB_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const KIARA_KB_MAX_BYTES = 10 * 1024 * 1024;
export const KIARA_KB_MAX_TEXT = 500_000;
export const KIARA_KB_MAX_CHUNKS = 3000;
/** Hard limit per chunk (database check). */
export const KIARA_CHUNK_MAX_CHARS = 8000;
/** Target size: about 700 English words. */
export const KIARA_CHUNK_TARGET_CHARS = 4500;
/** Below this many words a document is flagged "little text extracted". */
export const KIARA_LITTLE_TEXT_WORDS = 150;

export type KnowledgeChunk = Readonly<{ heading_path: string; content: string }>;
export type HeadingMode = "styles" | "bold" | "inferred" | "none";

export type KnowledgeText = Readonly<{
  text: string;
  wordCount: number;
  imageCount: number;
  /** How headings were found: Word heading styles, bold lines, inferred lines, or none. */
  headingMode: HeadingMode;
}>;

// ---------------------------------------------------------------------------
// HTML (mammoth output) to knowledge text
// ---------------------------------------------------------------------------

type Block =
  | Readonly<{ kind: "heading"; level: number; text: string }>
  | Readonly<{ kind: "para"; text: string; bold: boolean; afterRule: boolean }>
  | Readonly<{ kind: "item"; text: string }>
  | Readonly<{ kind: "row"; text: string; table: number }>;

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f​﻿]/g, "").replace(/\s+/g, " ").trim();

/** A horizontal rule typed as text ("---", "___", "***"). */
const isRule = (text: string) => /^(?:[-–—_*=~•·]\s*){3,}$/.test(text);

function parseBlocks(html: string): Readonly<{ blocks: Block[]; imageCount: number }> {
  const blocks: Block[] = [];
  let imageCount = 0;
  let buffer = "";
  let strongDepth = 0;
  let strongChars = 0;
  let plainChars = 0;
  let current: "heading" | "para" | "item" | null = null;
  let level = 1;
  let tableDepth = 0;
  let tableIndex = 0;
  let cells: string[] = [];
  let cell = "";
  let afterRule = false;

  const flush = () => {
    const text = clean(buffer);
    const kind = current;
    buffer = "";
    current = null;
    const bold = strongChars > 0 && plainChars === 0;
    strongChars = 0;
    plainChars = 0;
    if (!text || kind === null) return;
    if (kind === "heading") {
      blocks.push({ kind: "heading", level, text });
      afterRule = false;
    } else if (kind === "item") {
      blocks.push({ kind: "item", text });
      afterRule = false;
    } else if (isRule(text)) {
      afterRule = true;
    } else {
      blocks.push({ kind: "para", text, bold, afterRule });
      afterRule = false;
    }
  };

  const pattern = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>|([^<]+)/gi;
  for (const match of html.matchAll(pattern)) {
    const [, closing, rawTag, textPart] = match;
    if (textPart !== undefined) {
      const value = decodeEntities(textPart);
      if (tableDepth > 0) {
        cell += value;
      } else {
        if (current === null) current = "para";
        buffer += value;
        const visible = value.replace(/\s+/g, "").length;
        if (strongDepth > 0) strongChars += visible;
        else plainChars += visible;
      }
      continue;
    }
    const tag = (rawTag ?? "").toLowerCase();
    const isClose = closing === "/";
    if (tag === "img") {
      imageCount += 1;
      continue;
    }
    if (tag === "table") {
      if (!isClose) {
        if (tableDepth === 0) {
          flush();
          tableIndex += 1;
        }
        tableDepth += 1;
      } else {
        tableDepth = Math.max(0, tableDepth - 1);
      }
      continue;
    }
    if (tableDepth > 0) {
      // Inside a table: cells are joined with " | ", one row per line. Nested
      // tables and paragraphs inside a cell flatten into the cell's text.
      if ((tag === "td" || tag === "th") && isClose) {
        cells.push(clean(cell));
        cell = "";
      } else if (tag === "tr" && !isClose) {
        cells = [];
        cell = "";
      } else if (tag === "tr" && isClose && tableDepth === 1) {
        const row = cells.filter((value) => value !== "").join(" | ");
        if (row) blocks.push({ kind: "row", text: row, table: tableIndex });
        cells = [];
        afterRule = false;
      } else if ((tag === "p" || tag === "br" || tag === "li") && cell && !cell.endsWith(" ")) {
        cell += " ";
      }
      continue;
    }
    if (/^h[1-6]$/.test(tag)) {
      flush();
      if (!isClose) {
        current = "heading";
        level = Number(tag[1]);
      }
    } else if (tag === "p") {
      if (!isClose) {
        flush();
        current = "para";
      } else {
        flush();
      }
    } else if (tag === "li") {
      flush();
      if (!isClose) current = "item";
    } else if (tag === "ul" || tag === "ol") {
      flush();
    } else if (tag === "strong" || tag === "b") {
      strongDepth = Math.max(0, strongDepth + (isClose ? -1 : 1));
    } else if (tag === "br") {
      buffer += " ";
    }
  }
  flush();
  return { blocks, imageCount };
}

const letters = (text: string) => text.replace(/[^\p{L}]/gu, "");

/** Short, title-like lines in documents written without heading styles. */
function looksLikeHeading(block: Extract<Block, { kind: "para" }>): boolean {
  const text = block.text;
  if (text.length > 90 || /[.,;]$/.test(text)) return false;
  if (block.afterRule) return true;
  const latin = letters(text).replace(/[^A-Za-z]/g, "");
  if (latin.length >= 4 && latin === latin.toUpperCase()) return true;
  return /^(?:\d{1,2}[.)]\s+\S|[①-⑳]\s*\S)/u.test(text) && text.length <= 70;
}

const headingPrefix = (level: number) => "#".repeat(Math.min(Math.max(level, 1), 3));

/** A body line must not start like a heading line of the text format. */
const bodyLine = (text: string) => text.replace(/^#+(?=\s)/, "").trimStart();

/**
 * Mammoth HTML to knowledge text. Heading styles win; a document without them
 * uses bold-only paragraphs, then inferred title lines (after a "---" rule, in
 * capitals, or numbered like "1)"), and otherwise has no headings at all (the
 * chunker then cuts it by size).
 */
export function docxHtmlToKnowledgeText(html: string): KnowledgeText {
  const { blocks, imageCount } = parseBlocks(html);
  const paras = blocks.filter((block): block is Extract<Block, { kind: "para" }> => block.kind === "para");
  let mode: HeadingMode = "none";
  if (blocks.some((block) => block.kind === "heading")) mode = "styles";
  else if (paras.filter((block) => block.bold && block.text.length <= 120 && !/[.,;]$/.test(block.text)).length >= 2) mode = "bold";
  else if (paras.filter(looksLikeHeading).length >= 2) mode = "inferred";

  const parts: string[] = [];
  let group: string[] = [];
  let groupKind: "item" | "row" | null = null;
  let groupTable = 0;
  const closeGroup = () => {
    if (group.length) parts.push(group.join("\n"));
    group = [];
    groupKind = null;
  };
  for (const block of blocks) {
    if (block.kind === "item" || block.kind === "row") {
      const table = block.kind === "row" ? block.table : 0;
      if (groupKind !== block.kind || groupTable !== table) closeGroup();
      groupKind = block.kind;
      groupTable = table;
      group.push(block.kind === "item" ? `- ${bodyLine(block.text)}` : bodyLine(block.text));
      continue;
    }
    closeGroup();
    if (block.kind === "heading") {
      parts.push(`${headingPrefix(block.level)} ${block.text}`);
    } else if ((mode === "bold" && block.bold && block.text.length <= 120 && !/[.,;]$/.test(block.text))
      || (mode === "inferred" && looksLikeHeading(block))) {
      parts.push(`# ${block.text}`);
    } else {
      parts.push(bodyLine(block.text));
    }
  }
  closeGroup();
  const text = normalizeKnowledgeText(parts.filter(Boolean).join("\n\n"));
  return { text, wordCount: countWords(text), imageCount, headingMode: mode };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Line endings, trailing spaces, and blank-line runs normalized; no other change. */
export function normalizeKnowledgeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(text: string): number {
  const body = text.replace(/^#{1,3}\s+/gm, "").trim();
  return body ? body.split(/\s+/).length : 0;
}

export const isLittleText = (wordCount: number | null | undefined) => (wordCount ?? 0) < KIARA_LITTLE_TEXT_WORDS;

/**
 * A readable title from an uploaded file name: no extension, underscores, copy
 * suffixes like "(1)", a trailing upload date ("_30th July 2026"), or leading
 * symbols.
 */
export function knowledgeTitleFromFilename(filename: string): string {
  const title = filename
    .replace(/\.docx$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}\s*$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return (title || "Untitled document").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

type Span = Readonly<{ start: number; end: number }>;
/** A heading's own line (when it has one) and its body paragraphs. */
type Section = { names: string[]; headingStart: number | null; headingEnd: number; spans: Span[] };

const HEADING_LINE = /^(#{1,3})[ \t]+(\S.*)$/;

/** Splits one over-long span at line ends, then sentence ends, then hard. */
function splitSpan(text: string, span: Span, max: number): Span[] {
  const pieces: Span[] = [];
  let start = span.start;
  while (span.end - start > max) {
    const window = text.slice(start, start + max);
    let cut = window.lastIndexOf("\n");
    if (cut < max / 3) {
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "), window.lastIndexOf("। "));
      cut = sentence >= max / 3 ? sentence + 1 : -1;
    }
    if (cut < max / 3) {
      const space = window.lastIndexOf(" ");
      cut = space >= max / 3 ? space : max;
    }
    const end = start + cut;
    if (text.slice(start, end).trim()) pieces.push(trimSpan(text, { start, end }));
    start = end;
    while (start < span.end && /\s/.test(text[start] ?? "")) start += 1;
  }
  if (start < span.end && text.slice(start, span.end).trim()) pieces.push(trimSpan(text, { start, end: span.end }));
  return pieces;
}

function trimSpan(text: string, span: Span): Span {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start] ?? "")) start += 1;
  while (end > start && /\s/.test(text[end - 1] ?? "")) end -= 1;
  return { start, end };
}

function sectionsOf(text: string): Section[] {
  const sections: Section[] = [];
  const stack: string[] = [];
  let current: Section = { names: [], headingStart: null, headingEnd: 0, spans: [] };
  for (const match of text.matchAll(/[^\n]+(?:\n[^\n]+)*/g)) {
    const start = match.index ?? 0;
    const block = match[0];
    const firstEnd = block.indexOf("\n");
    const firstLine = firstEnd === -1 ? block : block.slice(0, firstEnd);
    const heading = HEADING_LINE.exec(firstLine);
    if (heading) {
      if (current.headingStart !== null || current.spans.length) sections.push(current);
      const level = heading[1]!.length;
      stack.length = level - 1;
      stack[level - 1] = clean(heading[2]!);
      current = { names: stack.filter(Boolean), headingStart: start, headingEnd: start + firstLine.length, spans: [] };
      if (firstEnd !== -1) {
        const body = trimSpan(text, { start: start + firstEnd + 1, end: start + block.length });
        if (body.end > body.start) current.spans.push(body);
      }
      continue;
    }
    const span = trimSpan(text, { start, end: start + block.length });
    if (span.end > span.start) current.spans.push(span);
  }
  if (current.headingStart !== null || current.spans.length) sections.push(current);
  return sections;
}

const sectionEnd = (section: Section) => section.spans.length ? section.spans[section.spans.length - 1]!.end : section.headingEnd;
const sectionStart = (section: Section) => section.headingStart ?? section.spans[0]?.start ?? 0;
const joinPath = (names: readonly string[]) => names.join(" > ").slice(0, 500);

function commonPrefix(group: readonly Section[]): string[] {
  const first = group[0]!.names;
  let length = first.length;
  for (const section of group) {
    let index = 0;
    while (index < length && section.names[index] === first[index]) index += 1;
    length = index;
  }
  return first.slice(0, length);
}

export type ChunkOptions = Readonly<{ targetChars?: number; packChars?: number }>;

/** Small neighbouring sections under one top-level heading share a chunk up to this size. */
export const KIARA_CHUNK_PACK_CHARS = 1200;

export type ChunkResult =
  | Readonly<{ ok: true; chunks: readonly KnowledgeChunk[] }>
  | Readonly<{ ok: false; error: string }>;

/**
 * Splits knowledge text into chunks by heading.
 * - Small neighbouring sections under the same top-level heading are packed into
 *   one chunk (up to `packChars`); its heading path is their common path and the
 *   sub-headings stay in the text, so a two-line section keeps its context.
 * - A larger section is a run of whole paragraphs (blank-line separated) up to
 *   the target size; a long one continues in a new chunk that repeats the
 *   previous paragraph when that paragraph is short (overlap), under the same
 *   heading path. A paragraph longer than the target is cut at line, sentence,
 *   or word ends. Text without headings is therefore cut by size.
 */
export function chunkKnowledgeText(input: string, options: ChunkOptions = {}): ChunkResult {
  const text = input;
  const target = Math.min(options.targetChars ?? KIARA_CHUNK_TARGET_CHARS, KIARA_CHUNK_MAX_CHARS);
  const pack = Math.min(options.packChars ?? KIARA_CHUNK_PACK_CHARS, target);
  if (!text.trim()) return { ok: false, error: "The document has no text." };
  if (text.length > KIARA_KB_MAX_TEXT) return { ok: false, error: "The text is longer than 500,000 characters. Split the document." };
  const sections = sectionsOf(text);
  if (!sections.some((section) => section.spans.length)) {
    // Headings only: keep them as text so nothing is lost.
    const all = trimSpan(text, { start: 0, end: text.length });
    return { ok: true, chunks: [{ heading_path: "", content: text.slice(all.start, all.end) }] };
  }

  const groups: Section[][] = [];
  for (const section of sections) {
    const group = groups[groups.length - 1];
    const head = group?.[0];
    if (group && head && (head.names[0] ?? "") === (section.names[0] ?? "") && sectionEnd(section) - sectionStart(head) <= pack) group.push(section);
    else groups.push([section]);
  }

  const chunks: KnowledgeChunk[] = [];
  for (const packed of groups) {
    // Leading heading-only sections are ancestors already named in the paths.
    const firstBody = packed.findIndex((section) => section.spans.length > 0);
    if (firstBody === -1) continue;
    const group = packed.slice(firstBody);
    if (group.length > 1) {
      const prefix = commonPrefix(group);
      const first = group[0]!;
      const start = prefix.length < first.names.length || !first.spans.length ? sectionStart(first) : first.spans[0]!.start;
      const span = trimSpan(text, { start, end: sectionEnd(group[group.length - 1]!) });
      chunks.push({ heading_path: joinPath(prefix), content: text.slice(span.start, span.end) });
      continue;
    }
    const section = group[0]!;
    const pieces = section.spans.flatMap((span) => (span.end - span.start > target ? splitSpan(text, span, target) : [span]));
    let first = 0;
    while (first < pieces.length) {
      let last = first;
      while (last + 1 < pieces.length && pieces[last + 1]!.end - pieces[first]!.start <= target) last += 1;
      chunks.push({ heading_path: joinPath(section.names), content: text.slice(pieces[first]!.start, pieces[last]!.end) });
      if (last + 1 >= pieces.length) break;
      const tail = pieces[last]!;
      const overlap = last > first && tail.end - tail.start <= target / 3
        && pieces[last + 1]!.end - tail.start <= target;
      first = overlap ? last : last + 1;
    }
  }
  if (chunks.length > KIARA_KB_MAX_CHUNKS) return { ok: false, error: "The document is too long (more than 3,000 sections). Split it." };
  return { ok: true, chunks };
}
