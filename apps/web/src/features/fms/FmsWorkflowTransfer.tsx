import { useMemo, useState } from "react";
import { Download, FileUp, Search } from "lucide-react";
import { createFmsFragment, exportFmsWorkflow, FmsTransferError, parseFmsTransfer, type FmsFlowDefinition, type FmsTransferPayload } from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { FmsData } from "./api";
import { flowToDefinition } from "./definition";

type Point = Readonly<{ x: number; y: number }>;
export type FmsImportRequest = Readonly<{ payload: FmsTransferPayload; replace: boolean }>;

/**
 * Import and export of workflow definitions. Export downloads a versioned
 * MK Jewels FMS file of the whole workflow or the selected steps. Import reads
 * such a file, pasted JSON, or another workflow the author can see; nothing is
 * applied until the preview is confirmed, and the result is always a draft.
 */
export function FmsWorkflowTransfer({ data, definition, currentFlowId, selectedKeys, positions, initialTab = "import", onClose, onImport }: {
  data: FmsData;
  definition: FmsFlowDefinition;
  currentFlowId: string | null;
  selectedKeys: readonly string[];
  positions: () => ReadonlyMap<string, Point>;
  initialTab?: "import" | "export";
  onClose: () => void;
  onImport: (request: FmsImportRequest) => void;
}) {
  const [tab, setTab] = useState<"import" | "export">(initialTab);
  const [source, setSource] = useState<"flow" | "file" | "paste">("flow");
  const [scope, setScope] = useState<"all" | "selected">(selectedKeys.length ? "selected" : "all");
  const [text, setText] = useState("");
  const [payload, setPayload] = useState<FmsTransferPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const empty = definition.stages.length === 0 || (definition.stages.length === 1 && !definition.stages[0]!.formTemplateId && !definition.stages[0]!.defaultNextStageKey);

  /** Newest version of each workflow family the author can see, excluding this one. */
  const flows = useMemo(() => {
    const latest = new Map<string, FmsData["flows"][number]>();
    for (const flow of data.flows) { if (flow.id === currentFlowId || flow.status === "archived") continue; const seen = latest.get(flow.family_id); if (!seen || flow.version > seen.version) latest.set(flow.family_id, flow); }
    return [...latest.values()].filter((flow) => flow.name.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  }, [currentFlowId, data.flows, query]);
  const flowDefinition = useMemo(() => { const flow = data.flows.find((item) => item.id === flowId); return flow ? flowToDefinition(flow, data) : null; }, [data, flowId]);

  const parse = (raw: string) => {
    setText(raw);
    try { setPayload(parseFmsTransfer(raw)); setError(null); }
    catch (caught) { setPayload(null); setError(caught instanceof FmsTransferError ? caught.message : "This file could not be read"); }
  };
  const readFile = async (file: File | undefined) => { if (!file) return; if (file.size > 1_000_000) { setError("The workflow file is too large (1 MB maximum)"); return; } parse(await file.text()); };

  const download = () => {
    const snapshot = positions();
    const body = scope === "selected" && selectedKeys.length ? createFmsFragment(definition, selectedKeys, snapshot) : exportFmsWorkflow(definition, snapshot);
    const slug = (definition.name || "workflow").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workflow";
    const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${slug}${scope === "selected" && selectedKeys.length ? "-steps" : ""}.fms.json`;
    document.body.append(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
    onClose();
  };

  const fromFlow: FmsTransferPayload | null = flowDefinition ? (() => {
    const keys = chosen.size ? [...chosen] : flowDefinition.stages.map((stage) => stage.key);
    const whole = keys.length === flowDefinition.stages.length;
    const fragment = createFmsFragment(flowDefinition, keys, new Map(flowDefinition.stages.flatMap((stage) => stage.position ? [[stage.key, stage.position] as const] : [])));
    return whole ? { kind: "workflow", name: flowDefinition.name, description: flowDefinition.description, stages: fragment.stages } : { kind: "fragment", name: flowDefinition.name, stages: fragment.stages };
  })() : null;
  const ready = source === "flow" ? fromFlow : payload;
  const apply = (replace: boolean) => {
    if (!ready) return;
    if (replace && !empty && !window.confirm("Replace every step in this draft with the imported workflow? You can undo this.")) return;
    onImport({ payload: ready, replace });
  };

  const tabButton = (value: typeof tab, label: string) => <button aria-selected={tab === value} className={cn("min-h-10 flex-1 rounded-lg text-sm font-semibold", tab === value ? "bg-gold text-on-gold" : "text-champagne")} onClick={() => setTab(value)} role="tab" type="button">{label}</button>;
  const sourceButton = (value: typeof source, label: string) => <button aria-pressed={source === value} className={cn("min-h-9 rounded-lg border px-3 text-xs font-semibold", source === value ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-champagne")} onClick={() => { setSource(value); setError(null); }} type="button">{label}</button>;

  return <Modal onClose={onClose} title="Import or export" wide>
    <div className="space-y-4">
      <div className="flex rounded-xl border border-gold/20 bg-charcoal p-1" role="tablist">{tabButton("import", "Import")}{tabButton("export", "Export")}</div>
      {tab === "export" ? <div className="space-y-3">
        <fieldset className="space-y-2"><legend className="label">What to export</legend>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input checked={scope === "all"} name="fms-export-scope" onChange={() => setScope("all")} type="radio" />Entire workflow ({definition.stages.length} steps)</label>
          <label className={cn("flex min-h-10 items-center gap-2 text-sm", !selectedKeys.length && "opacity-50")}><input checked={scope === "selected"} disabled={!selectedKeys.length} name="fms-export-scope" onChange={() => setScope("selected")} type="radio" />Selected steps ({selectedKeys.length})</label>
        </fieldset>
        <p className="text-xs text-soft-grey">The file holds the workflow design only: steps, routes, timing, assignments and linked form versions. No running work, answers or history.</p>
        <div className="flex justify-end"><Button onClick={download} type="button"><Download className="size-4" />Download JSON</Button></div>
      </div> : <div className="space-y-3">
        <div className="flex flex-wrap gap-2">{sourceButton("flow", "From another FMS")}{sourceButton("file", "JSON file")}{sourceButton("paste", "Paste JSON")}</div>
        {source === "flow" ? !flowDefinition ? <>
          <label className="relative block"><Search aria-hidden className="absolute left-3 top-3 size-4 text-soft-grey" /><input aria-label="Search workflows" className="field pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows" value={query} /></label>
          <ul className="max-h-[40dvh] space-y-1 overflow-y-auto">{flows.map((flow) => <li key={flow.id}><button className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-gold/15 px-3 text-left text-sm hover:border-gold/60" onClick={() => { setFlowId(flow.id); setChosen(new Set()); }} type="button"><span className="truncate font-semibold text-white">{flow.name}</span><span className="shrink-0 text-xs text-soft-grey">v{flow.version} · {flow.status}</span></button></li>)}{!flows.length ? <li className="text-sm text-soft-grey">No other workflows match.</li> : null}</ul>
        </> : <div className="space-y-2">
          <button className="text-xs font-semibold text-gold-secondary" onClick={() => setFlowId(null)} type="button">← {flowDefinition.name}</button>
          <p className="text-xs text-soft-grey">Leave everything unticked to import the entire workflow, or tick the steps to bring across.</p>
          <ul className="max-h-[36dvh] space-y-1 overflow-y-auto">{flowDefinition.stages.map((stage) => <li key={stage.key}><label className="flex min-h-10 items-center gap-2 rounded-lg border border-gold/15 px-3 text-sm"><input checked={chosen.has(stage.key)} onChange={(event) => setChosen((current) => { const next = new Set(current); if (event.target.checked) next.add(stage.key); else next.delete(stage.key); return next; })} type="checkbox" />{stage.name}</label></li>)}</ul>
        </div> : null}
        {source === "file" ? <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gold/30 text-sm text-champagne hover:border-gold"><FileUp className="size-5 text-gold-secondary" />Choose an .fms.json file<input accept="application/json,.json" className="sr-only" onChange={(event) => void readFile(event.target.files?.[0])} type="file" /></label> : null}
        {source === "paste" ? <textarea aria-label="Workflow JSON" className="field min-h-32 font-mono text-xs" onChange={(event) => parse(event.target.value)} placeholder='{"format":"mkjewels.fms.workflow", …}' value={text} /> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {ready ? <div className="rounded-lg border border-gold/20 p-3 text-sm">
          <p className="font-semibold text-white">{ready.kind === "workflow" ? "Workflow" : "Copied steps"}{ready.name ? `: ${ready.name}` : ""}</p>
          <p className="text-xs text-soft-grey">{ready.stages.length} step{ready.stages.length === 1 ? "" : "s"}: {ready.stages.slice(0, 6).map((stage) => stage.name).join(", ")}{ready.stages.length > 6 ? "…" : ""}</p>
          <p className="mt-1 text-xs text-soft-grey">Steps get new identifiers. Forms and people that are not available here are removed and reported. The draft is not published.</p>
        </div> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">Cancel</Button>
          {ready?.kind === "workflow" ? <Button onClick={() => apply(true)} type="button" variant="secondary">{empty ? "Use as this workflow" : "Replace this workflow"}</Button> : null}
          <Button disabled={!ready} onClick={() => apply(false)} type="button">Add to this workflow</Button>
        </div>
      </div>}
    </div>
  </Modal>;
}
