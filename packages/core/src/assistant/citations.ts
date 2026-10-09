/**
 * Knowledge-base citations (spec 7.5). Kiara cites with `[[cite:<chunk_id>]]`.
 * The server keeps a marker only when that chunk was returned to the same turn,
 * so a model (or an injected instruction) cannot invent a source. Phase 1 has
 * no knowledge base, so every marker is removed.
 */
export const CITATION_MARKER_PATTERN = /\[\[cite:([^\]\s]{1,64})\]\]/g;

export type KiaraCitationSource = Readonly<{
  chunk_id: string;
  document_id: string;
  version_id: string;
  title: string;
  heading_path: string;
}>;

export type KiaraCitation = KiaraCitationSource & Readonly<{ marker: number }>;

export type CitationResult = Readonly<{
  text: string;
  citations: readonly KiaraCitation[];
  removedMarkers: number;
}>;

/**
 * Replaces each valid marker with a numbered reference ("[1]") in order of first
 * use, and removes unknown markers together with the space before them.
 */
export function applyCitations(text: string, sources: ReadonlyMap<string, KiaraCitationSource>): CitationResult {
  const numbers = new Map<string, number>();
  const citations: KiaraCitation[] = [];
  let removedMarkers = 0;
  const replaced = text.replace(/ ?\[\[cite:([^\]\s]{1,64})\]\]/g, (match, chunkId: string) => {
    const source = sources.get(chunkId);
    if (!source) {
      removedMarkers += 1;
      return "";
    }
    let marker = numbers.get(chunkId);
    if (marker === undefined) {
      marker = numbers.size + 1;
      numbers.set(chunkId, marker);
      citations.push({ ...source, marker });
    }
    return `${match.startsWith(" ") ? " " : ""}[${marker}]`;
  });
  return { text: replaced, citations, removedMarkers };
}

/** For display while text is still streaming: hides whole and trailing partial markers. */
export function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_MARKER_PATTERN, "").replace(/\[\[(?:c(?:i(?:t(?:e(?::[^\]\s]{0,64})?)?)?)?)?$/, "");
}
