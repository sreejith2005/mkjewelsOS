import { Fragment, type ReactNode } from "react";
import { getPageForPath, stripCitationMarkers } from "@jewelos/core";

/**
 * The only formatting Kiara's answers may use (spec 12): paragraphs, bullet and
 * numbered lists, **bold**, and links to in-app sections. Images, HTML, code,
 * and external links are never rendered, so text that came from a tool result
 * cannot pull in content or send the reader off-site.
 */
export type KiaraBlock =
  | Readonly<{ kind: "paragraph"; text: string }>
  | Readonly<{ kind: "list"; ordered: boolean; items: readonly string[] }>;

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

/** An in-app link target, or null. Query strings are allowed; the path must be a known section. */
export function inAppPath(target: string): string | null {
  if (!target.startsWith("/") || target.startsWith("//")) return null;
  const path = target.split(/[?#]/)[0] ?? "";
  return getPageForPath(path) ? target : null;
}

function Inline({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }) {
  const parts = text.split(INLINE).filter(Boolean);
  return <>{parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong className="font-semibold" key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const path = inAppPath(link[2]!);
      return path
        ? <button className="font-semibold text-task-accent underline underline-offset-2" key={index} onClick={() => onNavigate(path)} type="button">{link[1]}</button>
        : <Fragment key={index}>{link[1]}</Fragment>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

export function KiaraMarkdown({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }): ReactNode {
  const blocks = parseKiaraBlocks(text);
  return <div className="space-y-2 break-words">{blocks.map((block, index) => block.kind === "paragraph"
    ? <p className="whitespace-pre-wrap" key={index}><Inline onNavigate={onNavigate} text={block.text} /></p>
    : block.ordered
      ? <ol className="list-decimal space-y-1 pl-5" key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><Inline onNavigate={onNavigate} text={item} /></li>)}</ol>
      : <ul className="list-disc space-y-1 pl-5" key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><Inline onNavigate={onNavigate} text={item} /></li>)}</ul>)}</div>;
}
