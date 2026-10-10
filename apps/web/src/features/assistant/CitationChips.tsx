import { useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import type { KiaraCitationData } from "@jewelos/core";
import { getKiaraKnowledgeExcerpt, type KiaraExcerpt } from "@jewelos/data/assistant/api";
import { Modal } from "@/components/ui";

/**
 * The sources behind an answer's [n] markers. Each chip opens the cited excerpt
 * (plain text, read through the same audience rules as search). There are no
 * file downloads (owner decision, spec 19 item 6).
 */
export function CitationChips({ citations, load = getKiaraKnowledgeExcerpt }: {
  citations: readonly KiaraCitationData[];
  load?: (chunkId: string) => Promise<KiaraExcerpt>;
}) {
  const [open, setOpen] = useState<KiaraCitationData | null>(null);
  const [excerpt, setExcerpt] = useState<KiaraExcerpt | "loading" | "error">("loading");
  if (citations.length === 0) return null;

  const show = async (citation: KiaraCitationData) => {
    setOpen(citation);
    setExcerpt("loading");
    try {
      setExcerpt(await load(citation.chunk_id));
    } catch {
      setExcerpt("error");
    }
  };

  return <div className="mt-2 border-t border-task-border pt-2">
    <p className="text-xs font-semibold text-task-text-muted">Sources</p>
    <ul className="mt-1 flex flex-wrap gap-1.5">
      {[...citations].sort((left, right) => left.marker - right.marker).map((citation) => <li key={citation.marker}>
        <button
          className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-task-border bg-task-muted px-3 text-left text-xs text-task-text hover:border-task-accent"
          onClick={() => void show(citation)}
          type="button"
        >
          <span className="font-semibold">[{citation.marker}]</span>
          <span className="truncate">{citation.title}{citation.heading_path ? ` · ${citation.heading_path}` : ""}</span>
        </button>
      </li>)}
    </ul>
    {open ? <Modal onClose={() => setOpen(null)} title={`[${open.marker}] ${open.title}`} tone="light">
      {open.heading_path ? <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-task-text"><BookOpen aria-hidden className="size-4 text-task-accent" />{open.heading_path}</p> : null}
      {excerpt === "loading" ? <p className="flex items-center gap-2 text-sm text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />Loading the section…</p> : null}
      {excerpt === "error" ? <p className="text-sm text-task-text-muted">The section could not be loaded. Please try again.</p> : null}
      {typeof excerpt === "object" && !excerpt.available ? <p className="text-sm text-task-text-muted">This section is no longer available. The document was changed, switched off, or removed.</p> : null}
      {typeof excerpt === "object" && excerpt.available ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-task-text">{excerpt.content}</p> : null}
    </Modal> : null}
  </div>;
}
