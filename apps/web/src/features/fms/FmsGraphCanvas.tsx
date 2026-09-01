import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { CheckSquare, Copy, FileText, Flag, GitBranch, Layers, Maximize, Merge, Minus, MousePointer2, Plus, ShieldCheck, Trash2, Zap } from "lucide-react";
import { fmsOutgoingStageKeys, hasFmsStageRouting, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
import { cn } from "@/lib/utils";
import { fmsGraphEdges, fmsStageSummary, fmsTimingSummary, layoutFmsDefinition, type FmsGraphEdge, type FmsGraphPosition } from "./graph";

const NODE_WIDTH = 208;
const NODE_HEIGHT = 104;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.15;
const WORLD_SIZE = 6000;
const FIT_PADDING = 80;
/** Pointer travel that separates a click from a drag, so selecting a card never nudges it. */
const DRAG_THRESHOLD = 4;

const appearance: Record<FmsStageDefinition["type"], { Icon: typeof CheckSquare; label: string; className: string }> = {
  task: { Icon: CheckSquare, label: "Step", className: "border-gold/40 bg-gold/10 text-gold" },
  form: { Icon: FileText, label: "Form", className: "border-success/40 bg-success/10 text-success" },
  approval: { Icon: ShieldCheck, label: "Approval", className: "border-gold/50 bg-gold/15 text-gold" },
  branch: { Icon: GitBranch, label: "Decision", className: "border-danger/40 bg-danger/10 text-danger" },
  parallel_start: { Icon: Layers, label: "Split", className: "border-gold/40 bg-charcoal text-champagne" },
  parallel_join: { Icon: Merge, label: "Join", className: "border-gold/40 bg-charcoal text-champagne" },
  notification: { Icon: Zap, label: "Notify", className: "border-gold/40 bg-gold/5 text-gold" },
  end: { Icon: Flag, label: "End", className: "border-success/40 bg-success/10 text-success" },
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const edgeId = (edge: FmsGraphEdge) => `${edge.from}->${edge.to}:${edge.ruleId ?? "default"}`;

type Drag =
  | Readonly<{ kind: "pan"; pointerX: number; pointerY: number; panX: number; panY: number }>
  | Readonly<{ kind: "node"; keys: readonly string[]; origins: ReadonlyMap<string, FmsGraphPosition>; worldX: number; worldY: number; moved: boolean; primary: string }>
  | Readonly<{ kind: "connect"; from: string }>
  | Readonly<{ kind: "reconnect"; from: string; to: string; ruleId?: string | undefined }>
  | Readonly<{ kind: "marquee"; additive: boolean; base: readonly string[] }>;

/** Axis-aligned overlap between a node box and the marquee rectangle. */
const overlaps = (point: FmsGraphPosition, box: Readonly<{ x: number; y: number; width: number; height: number }>) =>
  point.x < box.x + box.width && point.x + NODE_WIDTH > box.x && point.y < box.y + box.height && point.y + NODE_HEIGHT > box.y;

export function FmsGraphCanvas({ definition, selectedKey, invalidKeys, onSelect, onDelete, onDuplicate, onAddAfter, onConnect, onDisconnect, onReconnect, onMove }: {
  definition: FmsFlowDefinition;
  selectedKey: string | null;
  invalidKeys: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onDelete: (key: string) => void;
  onDuplicate: (key: string) => void;
  onAddAfter: (key: string) => void;
  onConnect: (from: string, to: string) => void;
  onDisconnect: (from: string, to: string, ruleId?: string) => void;
  onReconnect: (from: string, previousTo: string, nextTo: string, ruleId?: string) => void;
  onMove: (positions: Readonly<Record<string, FmsGraphPosition>>) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const hasCenteredRef = useRef(false);
  const layout = useMemo(() => layoutFmsDefinition(definition), [definition]);
  const edges = useMemo(() => fmsGraphEdges(definition.stages), [definition.stages]);
  const [offsets, setOffsets] = useState<Record<string, FmsGraphPosition>>({});
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<readonly string[]>(selectedKey ? [selectedKey] : []);
  const [connecting, setConnecting] = useState<Readonly<{ from: string; x: number; y: number }> | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Readonly<{ x: number; y: number; width: number; height: number }> | null>(null);
  const marqueeStart = useRef<FmsGraphPosition | null>(null);

  useEffect(() => setOffsets((current) => Object.fromEntries(Object.entries(current).filter(([key]) => definition.stages.some((stage) => stage.key === key)))), [definition.stages]);
  useEffect(() => setSelection((current) => { const live = current.filter((key) => definition.stages.some((stage) => stage.key === key)); return live.length === current.length ? current : live; }), [definition.stages]);
  useEffect(() => setSelection((current) => selectedKey && !current.includes(selectedKey) ? [selectedKey] : current), [selectedKey]);

  const saved = useMemo(() => new Map(definition.stages.flatMap((stage) => stage.position ? [[stage.key, stage.position] as const] : [])), [definition.stages]);

  /** A stage keeps its saved coordinates; without them it falls back to the computed layout. */
  const position = useCallback((key: string): FmsGraphPosition => {
    const base = saved.get(key) ?? layout.get(key) ?? { x: 60, y: 60 };
    const offset = offsets[key] ?? { x: 0, y: 0 };
    return { x: clamp(base.x + offset.x, 0, WORLD_SIZE - NODE_WIDTH), y: clamp(base.y + offset.y, 0, WORLD_SIZE - NODE_HEIGHT) };
  }, [layout, offsets, saved]);

  /** Client coordinates translated into canvas-world coordinates at the current pan/zoom. */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: ((clientX - (rect?.left ?? 0)) - pan.x) / zoom, y: ((clientY - (rect?.top ?? 0)) - pan.y) / zoom };
  }, [pan.x, pan.y, zoom]);

  const fitView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !definition.stages.length) return;
    const points = definition.stages.map((stage) => position(stage.key));
    const left = Math.min(...points.map((point) => point.x));
    const right = Math.max(...points.map((point) => point.x + NODE_WIDTH));
    const top = Math.min(...points.map((point) => point.y));
    const bottom = Math.max(...points.map((point) => point.y + NODE_HEIGHT));
    const next = clamp(Math.min((viewport.clientWidth - FIT_PADDING) / Math.max(1, right - left), (viewport.clientHeight - FIT_PADDING) / Math.max(1, bottom - top)), MIN_ZOOM, 1);
    setZoom(next);
    setPan({ x: viewport.clientWidth / 2 - ((left + right) / 2) * next, y: viewport.clientHeight / 2 - ((top + bottom) / 2) * next });
  }, [definition.stages, position]);

  useLayoutEffect(() => { if (!hasCenteredRef.current && definition.stages.length) { fitView(); hasCenteredRef.current = true; } }, [definition.stages.length, fitView]);

  /** Zooms around a viewport point so the content under the pointer stays put. */
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const anchorX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const anchorY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    setZoom((current) => {
      const next = clamp(current * factor, MIN_ZOOM, MAX_ZOOM);
      setPan((currentPan) => ({ x: anchorX - (anchorX - currentPan.x) * (next / current), y: anchorY - (anchorY - currentPan.y) * (next / current) }));
      return next;
    });
  }, []);

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) { zoomAt(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event.clientX, event.clientY); return; }
    setPan((current) => ({ x: current.x - (event.shiftKey ? event.deltaY : event.deltaX), y: current.y - (event.shiftKey ? 0 : event.deltaY) }));
  };

  const nodeKeyAt = (clientX: number, clientY: number) =>
    (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-node-key]")?.dataset.nodeKey ?? null;

  const beginPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-canvas-control]")) return;
    viewportRef.current?.focus({ preventScroll: true });
    const endpoint = target.closest<HTMLElement>("[data-edge-from]");
    const handle = target.closest<HTMLElement>("[data-node-output]");
    const card = target.closest<HTMLElement>("[data-node-key]");
    event.currentTarget.setPointerCapture(event.pointerId);
    if (endpoint?.dataset.edgeFrom && endpoint.dataset.edgeTo) {
      const from = endpoint.dataset.edgeFrom;
      const point = position(from);
      dragRef.current = { kind: "reconnect", from, to: endpoint.dataset.edgeTo, ruleId: endpoint.dataset.edgeRule || undefined };
      setConnecting({ from, x: point.x + NODE_WIDTH, y: point.y + NODE_HEIGHT / 2 });
      return;
    }
    if (handle?.dataset.nodeOutput) {
      const from = handle.dataset.nodeOutput;
      const point = position(from);
      dragRef.current = { kind: "connect", from };
      setConnecting({ from, x: point.x + NODE_WIDTH, y: point.y + NODE_HEIGHT / 2 });
      return;
    }
    if (card?.dataset.nodeKey && event.button === 0) {
      const key = card.dataset.nodeKey;
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const chosen = additive
        ? (selection.includes(key) ? selection.filter((item) => item !== key) : [...selection, key])
        : (selection.includes(key) ? selection : [key]);
      const keys = chosen.length ? chosen : [key];
      setSelection(keys);
      const world = toWorld(event.clientX, event.clientY);
      dragRef.current = { kind: "node", keys, origins: new Map(keys.map((item) => [item, position(item)])), worldX: world.x, worldY: world.y, moved: false, primary: key };
      return;
    }
    if (event.shiftKey && event.button === 0) {
      const world = toWorld(event.clientX, event.clientY);
      marqueeStart.current = world;
      dragRef.current = { kind: "marquee", additive: event.ctrlKey || event.metaKey, base: selection };
      setMarquee({ x: world.x, y: world.y, width: 0, height: 0 });
      return;
    }
    dragRef.current = { kind: "pan", pointerX: event.clientX, pointerY: event.clientY, panX: pan.x, panY: pan.y };
    if (!event.ctrlKey && !event.metaKey) setSelection([]);
  };

  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") { setPan({ x: drag.panX + (event.clientX - drag.pointerX), y: drag.panY + (event.clientY - drag.pointerY) }); return; }
    const world = toWorld(event.clientX, event.clientY);
    if (drag.kind === "marquee") {
      const start = marqueeStart.current;
      if (!start) return;
      const box = { x: Math.min(start.x, world.x), y: Math.min(start.y, world.y), width: Math.abs(world.x - start.x), height: Math.abs(world.y - start.y) };
      setMarquee(box);
      const inside = definition.stages.filter((stage) => overlaps(position(stage.key), box)).map((stage) => stage.key);
      setSelection(drag.additive ? [...new Set([...drag.base, ...inside])] : inside);
      return;
    }
    if (drag.kind === "connect" || drag.kind === "reconnect") {
      setConnecting((current) => current ? { ...current, x: world.x, y: world.y } : current);
      const hovered = nodeKeyAt(event.clientX, event.clientY);
      setDropTarget(hovered && hovered !== drag.from ? hovered : null);
      return;
    }
    const dx = world.x - drag.worldX;
    const dy = world.y - drag.worldY;
    if (!drag.moved && Math.hypot(dx * zoom, dy * zoom) < DRAG_THRESHOLD) return;
    dragRef.current = { ...drag, moved: true };
    setOffsets((current) => {
      const next = { ...current };
      for (const key of drag.keys) {
        const base = saved.get(key) ?? layout.get(key) ?? { x: 60, y: 60 };
        const origin = drag.origins.get(key) ?? base;
        next[key] = { x: clamp(origin.x + dx, 0, WORLD_SIZE - NODE_WIDTH) - base.x, y: clamp(origin.y + dy, 0, WORLD_SIZE - NODE_HEIGHT) - base.y };
      }
      return next;
    });
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === "marquee") { marqueeStart.current = null; setMarquee(null); return; }
    if (drag?.kind === "connect" || drag?.kind === "reconnect") {
      const target = nodeKeyAt(event.clientX, event.clientY);
      if (target && target !== drag.from) {
        if (drag.kind === "connect") onConnect(drag.from, target);
        else if (target !== drag.to) onReconnect(drag.from, drag.to, target, drag.ruleId);
      }
      setConnecting(null); setDropTarget(null);
      return;
    }
    if (drag?.kind !== "node") return;
    if (!drag.moved) { onSelect(drag.primary); return; }
    onMove(Object.fromEntries(drag.keys.map((key) => [key, position(key)])));
    setOffsets((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !drag.keys.includes(key))));
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(ZOOM_STEP); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomAt(1 / ZOOM_STEP); }
    else if (event.key === "0") { event.preventDefault(); setZoom(1); }
    else if (event.key === "1") { event.preventDefault(); fitView(); }
    else if (event.key === "Escape") setSelection([]);
    else if ((event.key === "Delete" || event.key === "Backspace") && selection.length === 1) { event.preventDefault(); onDelete(selection[0]!); }
  };

  const curve = (startX: number, startY: number, endX: number, endY: number) => {
    const bend = Math.max(48, Math.abs(endX - startX) / 2);
    return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
  };

  return <div
    aria-label="Workflow canvas"
    className="relative h-[52dvh] min-h-[26rem] touch-none overflow-hidden rounded-2xl border border-gold/20 bg-obsidian outline-none focus-visible:ring-1 focus-visible:ring-gold md:h-[calc(100dvh-19rem)] md:min-h-[34rem]"
    onKeyDown={onKeyDown}
    onPointerCancel={() => { dragRef.current = null; setConnecting(null); setDropTarget(null); }}
    onPointerDown={beginPointer}
    onPointerMove={movePointer}
    onPointerUp={endPointer}
    onWheel={onWheel}
    ref={viewportRef}
    role="application"
    tabIndex={0}
  >
    <div className="absolute right-3 top-3 z-30 flex gap-1 rounded-lg border border-gold/20 bg-charcoal p-1" data-canvas-control>
      <button aria-label="Zoom out" className="rounded p-2 text-gold hover:bg-gold/10" onClick={() => zoomAt(1 / ZOOM_STEP)} type="button"><Minus className="size-4" /></button>
      <span className="grid min-w-12 place-items-center text-xs text-champagne">{Math.round(zoom * 100)}%</span>
      <button aria-label="Zoom in" className="rounded p-2 text-gold hover:bg-gold/10" onClick={() => zoomAt(ZOOM_STEP)} type="button"><Plus className="size-4" /></button>
      <button aria-label="Fit workflow to view" className="rounded p-2 text-gold hover:bg-gold/10" onClick={fitView} type="button"><Maximize className="size-4" /></button>
    </div>
    <p className="pointer-events-none absolute left-4 top-4 z-30 flex max-w-[min(30rem,60%)] items-center gap-2 rounded-2xl border border-gold/20 bg-charcoal/95 px-3 py-1.5 text-xs text-soft-grey">
      <MousePointer2 className="size-3 shrink-0 text-gold" />Drag a card to move it · drag empty space to pan · Shift+drag to select several · scroll to move, Ctrl+scroll to zoom · drag a card&rsquo;s right dot onto another card to connect, or drag a connection&rsquo;s arrow end to move it
    </p>

    <div className={cn("absolute inset-0 overflow-hidden", connecting ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing")}>
      <div className="absolute origin-top-left bg-[radial-gradient(circle_at_1px_1px,rgba(217,184,117,0.16)_1px,transparent_0)] bg-[size:22px_22px]" style={{ height: WORLD_SIZE, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: WORLD_SIZE }}>
        <svg className="pointer-events-none absolute inset-0" height={WORLD_SIZE} width={WORLD_SIZE}>
          <defs><marker id="fms-arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M0,0 L0,7 L7,3.5 z" fill="currentColor" /></marker></defs>
          {edges.map((edge) => {
            const from = position(edge.from); const to = position(edge.to);
            const startX = from.x + NODE_WIDTH; const startY = from.y + NODE_HEIGHT / 2;
            const endX = to.x; const endY = to.y + NODE_HEIGHT / 2;
            const id = edgeId(edge);
            const active = hoveredEdge === id;
            const midX = (startX + endX) / 2; const midY = (startY + endY) / 2;
            const path = curve(startX, startY, endX, endY);
            const labelWidth = edge.label ? Math.min(200, edge.label.length * 6.4 + 18) : 0;
            return <g className={edge.kind === "branch" ? "text-danger" : edge.kind === "parallel" ? "text-champagne" : "text-gold"} key={id}>
              <path className="pointer-events-auto" d={path} fill="none" onPointerEnter={() => setHoveredEdge(id)} onPointerLeave={() => setHoveredEdge((current) => current === id ? null : current)} stroke="transparent" strokeWidth="20" />
              <path d={path} fill="none" markerEnd="url(#fms-arrow)" stroke="currentColor" strokeDasharray={edge.kind === "parallel" ? "4 4" : undefined} strokeOpacity={active ? 1 : 0.85} strokeWidth={active ? 3 : 2} />
              {edge.label ? <g><rect fill="rgb(var(--color-charcoal))" height="18" rx="9" stroke="currentColor" strokeOpacity="0.45" width={labelWidth} x={midX - labelWidth / 2} y={midY - 27} /><text fill="currentColor" fontSize="11" textAnchor="middle" x={midX} y={midY - 14}>{edge.label.length > 29 ? `${edge.label.slice(0, 28)}…` : edge.label}</text></g> : null}
              {active ? <g className="pointer-events-auto cursor-pointer" data-canvas-control onPointerEnter={() => setHoveredEdge(id)} onPointerLeave={() => setHoveredEdge((current) => current === id ? null : current)}>
                <circle cx={midX} cy={midY} fill="rgb(var(--color-charcoal))" onClick={() => onDisconnect(edge.from, edge.to, edge.ruleId)} r="11" stroke="currentColor" strokeWidth="1.5"><title>{`Remove the connection to ${edge.to}`}</title></circle>
                <path className="pointer-events-none" d={`M ${midX - 4} ${midY - 4} L ${midX + 4} ${midY + 4} M ${midX + 4} ${midY - 4} L ${midX - 4} ${midY + 4}`} stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
              </g> : null}
              {active ? <circle className="pointer-events-auto cursor-crosshair" cx={endX - 10} cy={endY} data-edge-from={edge.from} data-edge-rule={edge.ruleId ?? ""} data-edge-to={edge.to} fill="rgb(var(--color-charcoal))" onPointerEnter={() => setHoveredEdge(id)} r="7" stroke="currentColor" strokeWidth="2"><title>{`Drag to move this connection onto another step`}</title></circle> : null}
            </g>;
          })}
          {marquee ? <rect className="text-gold" fill="currentColor" fillOpacity="0.08" height={marquee.height} rx="4" stroke="currentColor" strokeDasharray="4 4" strokeWidth="1.5" width={marquee.width} x={marquee.x} y={marquee.y} /> : null}
          {connecting ? <path className="text-gold" d={curve(position(connecting.from).x + NODE_WIDTH, position(connecting.from).y + NODE_HEIGHT / 2, connecting.x, connecting.y)} fill="none" markerEnd="url(#fms-arrow)" stroke="currentColor" strokeDasharray="5 5" strokeWidth="2" /> : null}
        </svg>

        {definition.stages.map((stage) => {
          const point = position(stage.key); const item = appearance[stage.type];
          const active = selection.includes(stage.key) || stage.key === selectedKey;
          const invalid = invalidKeys.has(stage.key);
          const canOutput = stage.type !== "end";
          const canAppend = !["end", "branch", "parallel_start"].includes(stage.type);
          const isFirst = definition.stages[0]?.key === stage.key;
          const isLeaf = fmsOutgoingStageKeys(stage).length === 0 && stage.type !== "end";
          const routed = hasFmsStageRouting(stage) || stage.type === "branch";
          return <article
            aria-label={stage.name || "Untitled stage"}
            className={cn(
              "absolute cursor-grab select-none rounded-xl border p-3 text-left shadow-lg transition-colors active:cursor-grabbing",
              active ? "border-gold bg-charcoal ring-2 ring-gold" : "border-gold/25 bg-charcoal/95 hover:border-gold",
              invalid && "border-danger ring-2 ring-danger",
              dropTarget === stage.key && "border-success ring-2 ring-success",
            )}
            data-node-key={stage.key}
            key={stage.key}
            style={{ height: NODE_HEIGHT, left: point.x, top: point.y, width: NODE_WIDTH }}
          >
            {isFirst ? <span className="pointer-events-none absolute -top-7 left-0 rounded-md border border-gold/30 bg-charcoal px-2 py-1 text-[10px] font-semibold text-gold">Starts here</span> : null}
            {isLeaf ? <span className="pointer-events-none absolute -bottom-7 left-0 rounded-md border border-success/30 bg-charcoal px-2 py-1 text-[10px] font-semibold text-success">Completes here</span> : null}
            <div className="mb-2 flex items-center justify-between gap-1">
              <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", item.className)}><item.Icon className="size-3" />{stage.sla.decisionMode === "yes_no" || stage.sla.decisionMode === "decision" ? "Decision" : item.label}</span>
              <span className="flex gap-1" data-canvas-control>
                <button aria-label={`Duplicate ${stage.name}`} className="rounded p-1 text-soft-grey hover:bg-gold/10 hover:text-gold" onClick={() => onDuplicate(stage.key)} type="button"><Copy className="size-3.5" /></button>
                <button aria-label={`Delete ${stage.name}`} className="rounded p-1 text-soft-grey hover:bg-danger/10 hover:text-danger" onClick={() => onDelete(stage.key)} type="button"><Trash2 className="size-3.5" /></button>
              </span>
            </div>
            <span className="block truncate text-sm font-semibold text-white">{stage.name || "Untitled stage"}</span>
            <span className="mt-1 block truncate text-xs text-soft-grey">{fmsStageSummary(stage)} &middot; {fmsTimingSummary(stage)}</span>
            {invalid ? <span className="mt-1 block truncate text-xs font-medium text-danger">Needs attention</span> : null}
            <span aria-hidden="true" className="pointer-events-none absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-charcoal bg-gold/70" />
            {canOutput ? <button
              aria-label={`Drag to connect ${stage.name} to another step`}
              className="absolute -right-4 top-1/2 grid size-8 -translate-y-1/2 cursor-crosshair place-items-center rounded-full"
              data-node-output={stage.key}
              type="button"
            ><span className={cn("size-4 rounded-full border-2 border-charcoal shadow transition hover:scale-125", routed ? "bg-danger" : "bg-gold")} /></button> : null}
            {canAppend ? <button aria-label={`Add next step after ${stage.name}`} className="absolute -right-14 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-gold/40 bg-charcoal text-gold shadow transition hover:bg-gold hover:text-obsidian" data-canvas-control onClick={() => onAddAfter(stage.key)} type="button"><Plus className="size-4" /></button> : null}
          </article>;
        })}
      </div>
    </div>

    {selection.length > 1 ? <p className="pointer-events-none absolute bottom-3 left-4 z-30 rounded-full border border-gold/20 bg-charcoal/95 px-3 py-1 text-xs text-champagne">{selection.length} steps selected &middot; drag to move them together</p> : null}
    {connecting ? <p className="pointer-events-none absolute bottom-3 right-4 z-30 rounded-full border border-gold/40 bg-charcoal px-3 py-1 text-xs text-gold">Drop on a step to connect &middot; release on empty space to cancel</p> : null}
  </div>;
}
