import { Fragment, type ReactNode } from "react";
import { kiaraInAppPath, parseKiaraBlocks, sanitizeKiaraText, splitKiaraInline, type KiaraBlock } from "@jewelos/core";

/**
 * The only formatting Kiara's answers may use (spec 12): paragraphs, bullet and
 * numbered lists, **bold**, and links to in-app sections. The rules live in
 * `@jewelos/core` (assistant/markdown.ts), shared with the Android app.
 */
export { parseKiaraBlocks, sanitizeKiaraText, type KiaraBlock };
export const inAppPath = kiaraInAppPath;

function Inline({ text, onNavigate }: { text: string; onNavigate: (path: string) => void }) {
  return <>{splitKiaraInline(text).map((part, index) => {
    if (part.kind === "bold") return <strong className="font-semibold" key={index}>{part.text}</strong>;
    if (part.kind === "link") {
      const path = part.path;
      return path
        ? <button className="font-semibold text-task-accent underline underline-offset-2" key={index} onClick={() => onNavigate(path)} type="button">{part.label}</button>
        : <Fragment key={index}>{part.label}</Fragment>;
    }
    return <Fragment key={index}>{part.text}</Fragment>;
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
