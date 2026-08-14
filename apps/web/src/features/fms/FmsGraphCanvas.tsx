import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { CheckSquare, Copy, FileText, Flag, GitBranch, Layers, Maximize, Merge, Minus, Plus, ShieldCheck, Trash2, Zap } from "lucide-react";
import { fmsOutgoingStageKeys, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
import { cn } from "@/lib/utils";
import { fmsGraphEdges, fmsStageSummary, layoutFmsDefinition, type FmsGraphPosition } from "./graph";

const NODE_WIDTH = 208;
const NODE_HEIGHT = 100;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 1.6;
const ZOOM_STEP = 0.05;
const WORLD_SIZE = 5000;

const appearance: Record<FmsStageDefinition["type"], { Icon: typeof CheckSquare; label: string; className: string }> = {
  task: { Icon: CheckSquare, label: "Task", className: "border-gold/40 bg-gold/10 text-gold" },
  form: { Icon: FileText, label: "Form", className: "border-success/40 bg-success/10 text-success" },
  approval: { Icon: ShieldCheck, label: "Approval", className: "border-gold/50 bg-gold/15 text-gold" },
  branch: { Icon: GitBranch, label: "Decision", className: "border-danger/40 bg-danger/10 text-danger" },
  parallel_start: { Icon: Layers, label: "Split", className: "border-gold/40 bg-charcoal text-champagne" },
  parallel_join: { Icon: Merge, label: "Join", className: "border-gold/40 bg-charcoal text-champagne" },
  notification: { Icon: Zap, label: "Notify", className: "border-gold/40 bg-gold/5 text-gold" },
  end: { Icon: Flag, label: "End", className: "border-success/40 bg-success/10 text-success" },
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

type DragState = Readonly<{ kind: "pan" | "node"; key?: string; pointerX: number; pointerY: number; originX: number; originY: number }>;

export function FmsGraphCanvas({ definition, selectedKey, invalidKeys, onSelect, onDelete, onDuplicate, onAddAfter, onConnect }: { definition: FmsFlowDefinition; selectedKey: string | null; invalidKeys: ReadonlySet<string>; onSelect: (key: string) => void; onDelete: (key: string) => void; onDuplicate: (key: string) => void; onAddAfter: (key: string) => void; onConnect: (from: string, to: string) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const hasCenteredRef = useRef(false);
  const layout = useMemo(() => layoutFmsDefinition(definition), [definition]);
  const edges = useMemo(() => fmsGraphEdges(definition.stages), [definition.stages]);
  const [offsets, setOffsets] = useState<Record<string, FmsGraphPosition>>({});
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [draggingFrom, setDraggingFrom] = useState<string | null>(null);

  useEffect(() => setOffsets((current) => Object.fromEntries(Object.entries(current).filter(([key]) => definition.stages.some((stage) => stage.key === key)))), [definition.stages]);

  const position = (key: string) => {
    const base = layout.get(key) ?? { x: 60, y: 60 };
    const offset = offsets[key] ?? { x: 0, y: 0 };
    return { x: clamp(base.x + offset.x, 0, WORLD_SIZE - NODE_WIDTH), y: clamp(base.y + offset.y, 0, WORLD_SIZE - NODE_HEIGHT) };
  };

  const centerView = (viewZoom = zoom) => {
    const viewport = viewportRef.current;
    if (!viewport || definition.stages.length === 0) return;
    const points = definition.stages.map((stage) => layout.get(stage.key) ?? { x: 60, y: 60 });
    const left = Math.min(...points.map((point) => point.x));
    const right = Math.max(...points.map((point) => point.x + NODE_WIDTH));
    const top = Math.min(...points.map((point) => point.y));
    const bottom = Math.max(...points.map((point) => point.y + NODE_HEIGHT));
    setPan({ x: viewport.clientWidth / 2 - ((left + right) / 2) * viewZoom, y: viewport.clientHeight / 2 - ((top + bottom) / 2) * viewZoom });
  };

  useLayoutEffect(() => {
    if (!hasCenteredRef.current) {
      centerView();
      hasCenteredRef.current = true;
    }
  }, [layout]);

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.pointerX;
    const dy = event.clientY - drag.pointerY;
    if (drag.kind === "pan") {
      setPan({ x: clamp(drag.originX + dx, -WORLD_SIZE, WORLD_SIZE), y: clamp(drag.originY + dy, -WORLD_SIZE, WORLD_SIZE) });
    } else if (drag.key) {
      const base = layout.get(drag.key) ?? { x: 60, y: 60 };
      setOffsets((current) => ({ ...current, [drag.key!]: { x: clamp((drag.originX + dx / zoom) - base.x, -base.x, WORLD_SIZE - NODE_WIDTH - base.x), y: clamp((drag.originY + dy / zoom) - base.y, -base.y, WORLD_SIZE - NODE_HEIGHT - base.y) } }));
    }
  };

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-canvas-interactive]")) return;
    dragRef.current = { kind: "pan", pointerX: event.clientX, pointerY: event.clientY, originX: pan.x, originY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginNodeDrag = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    const point = position(key);
    dragRef.current = { kind: "node", key, pointerX: event.clientX, pointerY: event.clientY, originX: point.x, originY: point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const stop = () => { dragRef.current = null; setDraggingFrom(null); };
  const changeZoom = (amount: number) => setZoom((value) => clamp(value + amount, MIN_ZOOM, MAX_ZOOM));
  const onWheel = (event: WheelEvent<HTMLDivElement>) => { event.preventDefault(); changeZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP); };
  const resetView = () => { setZoom(1); centerView(1); };

  return <div className="relative h-[52dvh] min-h-[26rem] overflow-hidden rounded-2xl border border-gold/20 bg-obsidian sm:h-[calc(100dvh-15rem)] sm:min-h-[38rem]" onPointerDown={beginPan} onPointerMove={move} onPointerUp={stop} onWheel={onWheel} ref={viewportRef}>
    <div className="absolute right-3 top-3 z-30 flex gap-1 rounded-lg border border-gold/20 bg-charcoal p-1" data-canvas-interactive>
      <button aria-label="Zoom out" className="rounded p-2 text-gold hover:bg-gold/10" onClick={() => changeZoom(-ZOOM_STEP)} type="button"><Minus className="size-4" /></button>
      <span className="grid min-w-12 place-items-center text-xs text-champagne">{Math.round(zoom * 100)}%</span>
      <button aria-label="Zoom in" className="rounded p-2 text-gold hover:bg-gold/10" onClick={() => changeZoom(ZOOM_STEP)} type="button"><Plus className="size-4" /></button>
      <button aria-label="Reset canvas view" className="rounded p-2 text-gold hover:bg-gold/10" onClick={resetView} type="button"><Maximize className="size-4" /></button>
    </div>
    <div className="absolute left-4 top-4 z-30 rounded-full border border-gold/20 bg-charcoal/95 px-3 py-1 text-xs text-soft-grey">Click and hold empty space to pan · drag cards to move · bounded {Math.round(MIN_ZOOM * 100)}–{Math.round(MAX_ZOOM * 100)}% zoom</div>
    <div className="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing">
      <div className="absolute origin-top-left bg-[radial-gradient(circle_at_1px_1px,rgba(217,184,117,0.16)_1px,transparent_0)] bg-[size:22px_22px]" style={{ height: WORLD_SIZE, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: WORLD_SIZE }}>
        <svg aria-hidden="true" className="pointer-events-none absolute inset-0" height={WORLD_SIZE} width={WORLD_SIZE}>
          <defs><marker id="fms-arrow" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3"><path d="M0,0 L0,6 L6,3 z" fill="currentColor" /></marker></defs>
          {edges.map((edge, index) => {
            const from = position(edge.from); const to = position(edge.to);
            const startX = from.x + NODE_WIDTH; const startY = from.y + NODE_HEIGHT / 2; const endX = to.x; const endY = to.y + NODE_HEIGHT / 2;
            const bend = Math.max(48, Math.abs(endX - startX) / 2);
            return <g className={edge.kind === "branch" ? "text-danger" : edge.kind === "parallel" ? "text-champagne" : "text-gold"} key={`${edge.from}-${edge.to}-${index}`}><path d={`M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`} fill="none" markerEnd="url(#fms-arrow)" stroke="currentColor" strokeDasharray={edge.kind === "parallel" ? "4 4" : undefined} strokeWidth="2" />{edge.label ? <text fill="currentColor" fontSize="11" textAnchor="middle" x={(startX + endX) / 2} y={(startY + endY) / 2 - 8}>{edge.label}</text> : null}</g>;
          })}
        </svg>
        {definition.stages.map((stage) => {
          const point = position(stage.key); const item = appearance[stage.type]; const selected = stage.key === selectedKey; const invalid = invalidKeys.has(stage.key); const canOutput = stage.type !== "end"; const canAppend = !["end", "branch", "parallel_start"].includes(stage.type);
          const isFirst = definition.stages[0]?.key === stage.key;
          const isLeaf = fmsOutgoingStageKeys(stage).length === 0 && stage.type !== "end";
          return <article className={cn("absolute w-[13rem] rounded-xl border p-3 text-left shadow-lg transition", selected ? "border-gold bg-charcoal ring-1 ring-gold" : "border-gold/25 bg-charcoal/95 hover:border-gold", invalid && "border-danger ring-1 ring-danger")} data-canvas-interactive key={stage.key} style={{ left: point.x, top: point.y }}>
            {isFirst ? <span className="absolute -top-7 left-0 rounded-md border border-gold/30 bg-charcoal px-2 py-1 text-[10px] font-semibold text-gold">Starts here</span> : null}
            {isLeaf ? <span className="absolute -bottom-7 left-0 rounded-md border border-success/30 bg-charcoal px-2 py-1 text-[10px] font-semibold text-success">Completes here</span> : null}
            <button aria-label={`Move ${stage.name}`} className="absolute inset-x-0 top-0 h-7 cursor-move rounded-t-xl" onPointerDown={(event) => beginNodeDrag(event, stage.key)} type="button" />
            <div className="mb-2 flex items-center justify-between gap-1"><button className={cn("relative z-10 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", item.className)} onClick={() => onSelect(stage.key)} type="button"><item.Icon className="size-3" />{item.label}</button><span className="relative z-10 flex gap-1"><button aria-label={`Duplicate ${stage.name}`} className="rounded p-1 text-soft-grey hover:bg-gold/10 hover:text-gold" onClick={() => onDuplicate(stage.key)} type="button"><Copy className="size-3.5" /></button><button aria-label={`Delete ${stage.name}`} className="rounded p-1 text-soft-grey hover:bg-danger/10 hover:text-danger" onClick={() => onDelete(stage.key)} type="button"><Trash2 className="size-3.5" /></button></span></div>
            <button className="relative z-10 block w-full text-left" onClick={() => onSelect(stage.key)} type="button"><span className="block truncate text-sm font-semibold text-white">{stage.name || "Untitled stage"}</span><span className="mt-1 block truncate text-xs text-soft-grey">{fmsStageSummary(stage)} · due {stage.sla.dueDate || "not set"}</span>{invalid ? <span className="mt-2 block text-xs font-medium text-danger">Needs attention</span> : null}</button>
            <button aria-label={`Connect into ${stage.name}`} className="absolute -left-2 top-1/2 z-10 size-4 -translate-y-1/2 rounded-full border-2 border-charcoal bg-gold shadow" onPointerUp={(event) => { event.stopPropagation(); if (draggingFrom && draggingFrom !== stage.key) onConnect(draggingFrom, stage.key); setDraggingFrom(null); }} type="button" />
            {canOutput ? <button aria-label={`Drag to connect after ${stage.name}`} className="absolute -right-2 top-1/2 z-10 size-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-charcoal bg-gold shadow" onPointerDown={(event) => { event.stopPropagation(); setDraggingFrom(stage.key); }} type="button" /> : null}
            {canAppend ? <button aria-label={`Add next stage after ${stage.name}`} className="absolute -right-12 top-1/2 z-10 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-gold/40 bg-charcoal text-gold shadow hover:bg-gold hover:text-obsidian" onClick={() => onAddAfter(stage.key)} type="button"><Plus className="size-4" /></button> : null}
          </article>;
        })}
      </div>
    </div>
  </div>;
}
