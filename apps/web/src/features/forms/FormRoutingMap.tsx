import { ArrowDown, ArrowRight, GitBranch, X } from "lucide-react";
import type { FormFieldDefinition, FormSectionDefinition } from "@jewelos/core";
import { Button } from "@/components/ui";
import { buildFormRoutingMap } from "./routingMap";

export function FormRoutingMap({ fields, onClose, onNavigate, sections }: { fields: readonly FormFieldDefinition[]; onClose: () => void; onNavigate: (fieldKey: string) => void; sections: readonly FormSectionDefinition[] }) {
  const map = buildFormRoutingMap(fields, sections);
  const nodeById = new Map(map.nodes.map((node) => [node.id, node]));
  const conditionalFrom = new Map<string, typeof map.edges>();
  for (const edge of map.edges) if (edge.kind === "conditional") conditionalFrom.set(edge.from, [...(conditionalFrom.get(edge.from) ?? []), edge]);
  return <div aria-label="Form routing map" aria-modal="true" className="fixed inset-0 z-50 overflow-y-auto bg-obsidian/95 p-3 backdrop-blur sm:p-6" role="dialog"><div className="mx-auto max-w-4xl">
    <header className="sticky top-0 z-10 mb-5 flex items-center gap-3 border-b border-gold/20 bg-obsidian/95 py-3"><div className="mr-auto"><h2 className="flex items-center gap-2 text-xl font-semibold text-gold"><GitBranch className="size-5" />Routing map</h2><p className="text-xs text-soft-grey">The complete form from Start to End. Gold paths are conditional; select a question to edit it.</p></div><Button aria-label="Close routing map" className="size-10 p-0" onClick={onClose} type="button" variant="ghost"><X className="size-5" /></Button></header>
    <div className="mx-auto max-w-2xl">{map.nodes.map((node, index) => { const outgoing = conditionalFrom.get(node.id) ?? []; return <div className="relative" key={node.id}>
      {index > 0 ? <div className="flex h-8 items-center justify-center text-soft-grey"><ArrowDown aria-hidden className="size-4" /></div> : null}
      {node.kind === "question" ? <button aria-label={`Open ${node.label}`} className="w-full rounded-xl border border-gold/20 bg-charcoal/70 p-3 text-left transition hover:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold" onClick={() => { onNavigate(node.fieldKey!); onClose(); }} type="button"><span className="text-[0.65rem] font-semibold uppercase tracking-wide text-soft-grey">Question</span><span className="mt-0.5 block font-medium text-champagne">{node.label}</span>{node.converging ? <span className="mt-1 block text-xs text-gold">Paths converge here</span> : null}</button>
        : <div className={`mx-auto w-fit min-w-36 rounded-xl border px-4 py-2 text-center ${node.kind === "start" || node.kind === "end" ? "border-success/40 bg-success/10 text-success" : "border-gold/30 bg-gold/10 text-gold"}`}><span className="text-xs font-semibold uppercase tracking-wide">{node.kind}</span><span className="block text-sm font-medium">{node.label}</span>{node.converging ? <span className="block text-[0.65rem]">Paths converge</span> : null}</div>}
      {outgoing.length ? <div className="ml-6 mt-2 space-y-1 border-l border-gold/40 pl-3">{outgoing.map((edge, edgeIndex) => <div className="flex items-center gap-2 text-xs" key={`${edge.to}-${edge.label}-${edgeIndex}`}><span className="rounded-full bg-gold/15 px-2 py-1 font-medium text-gold">{edge.label}</span><ArrowRight aria-hidden className="size-3.5 text-gold" /><span className="text-champagne">{nodeById.get(edge.to)?.label ?? "End"}</span></div>)}</div> : null}
    </div>; })}</div>
  </div></div>;
}

