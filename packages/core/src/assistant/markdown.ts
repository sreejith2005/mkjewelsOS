import { getPageForPath } from "../roleMenu.ts";
import { stripCitationMarkers } from "./citations.ts";
import { isKiaraCrmPath } from "./crmLinks.ts";

/**
 * The only formatting Kiara's answers may use (spec 12): paragraphs, bullet and
 * numbered lists, **bold**, and links to in-app sections. Images, HTML, code,
 * and external links are never rendered, so text that came from a tool result
 * cannot pull in content or send the reader off-site. Web and Android render
 * the blocks this module produces.
 */
export type KiaraBlock =
  | Readonly<{ kind: "paragraph"; text: string }>
  | Readonly<{ kind: "list"; ordered: boolean; items: readonly string[] }>;

/** One run of inline text: plain, bold, or a link (path null when it is not an in-app link). */
export type KiaraInline =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "bold"; text: string }>
  | Readonly<{ kind: "link"; label: string; path: string | null }>;

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** Removes what is never shown: HTML tags, images, code fences, heading marks, cite markers. */
export function sanitizeKiaraText(text: string): string {
  return stripCitationMarkers(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "");
}

export function parseKiaraBlocks(text: string): KiaraBlock[] {
  const blocks: KiaraBlock[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  for (const line of sanitizeKiaraText(text).split("\n")) {
    const bullet = line.match(BULLET);
    const numbered = bullet ? null : line.match(NUMBERED);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      flushParagraph();
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

/**
 * An in-app link target, or null. Query strings are allowed; the path must be a
 * known section, or a CRM client record / CRM list screen (isKiaraCrmPath).
 */
export function kiaraInAppPath(target: string): string | null {
  if (!target.startsWith("/") || target.startsWith("//")) return null;
  const path = target.split(/[?#]/)[0] ?? "";
  return getPageForPath(path) || isKiaraCrmPath(path) ? target : null;
}

/** Splits a block's text into plain, bold, and link runs. */
export function splitKiaraInline(text: string): KiaraInline[] {
  return text.split(INLINE).filter(Boolean).map((part): KiaraInline => {
    if (part.startsWith("**") && part.endsWith("**")) return { kind: "bold", text: part.slice(2, -2) };
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) return { kind: "link", label: link[1]!, path: kiaraInAppPath(link[2]!) };
    return { kind: "text", text: part };
  });
}
