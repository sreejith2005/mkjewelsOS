import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { CheckSquare, CircleHelp, ClipboardPaste, Copy, CopyPlus, FileText, Flag, GitBranch, Hand, Info, Layers, LayoutGrid, Maximize, Merge, Minus, MousePointer2, Pencil, Plus, Scissors, ShieldCheck, Trash2, Waypoints, X, Zap } from "lucide-react";
import { FMS_MIN_ZOOM as MIN_ZOOM, FMS_MAX_ZOOM as MAX_ZOOM, fmsWheelZoomFactor, routeFmsGraphEdges, fmsOutgoingStageKeys, hasFmsStageRouting, zoomFmsViewport, type FmsFlowDefinition, type FmsFormFieldRef, type FmsStageDefinition, type FmsViewport } from "@jewelos/core";
import { useIsMobile } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { fmsCanvasOvershoot, fmsGraphEdges, fmsStageSummary, fmsTimingSummary, layoutFmsDefinition, type FmsGraphEdge, type FmsGraphPosition } from "./graph";
import { fmsShortcutContext } from "./shortcuts";

const NODE_WIDTH = 208;
const NODE_HEIGHT = 104;
const ZOOM_STEP = 1.15;
const WORLD_SIZE = 6000;
const FIT_PADDING = 80;
/** Pointer travel that separates a click from a drag, so selecting a card never nudges it. */
const DRAG_THRESHOLD = 4;
/** Screen width of a connection's invisible hit line: wide enough to hit, narrow enough not to cover its neighbours. */
const EDGE_HIT_PX = 10;
const LONG_PRESS_MS = 450;
const TIP_KEY = "jewelos.fms.canvasTip.v1";

const appearance: Record<FmsStageDefinition["type"], { Icon: typeof CheckSquare; label: string; className: string }> = {
  task: { Icon: CheckSquare, label: "Step", className: "border-gold/40 bg-gold/10 text-gold-secondary" },
  form: { Icon: FileText, label: "Form", className: "border-success/40 bg-success/10 text-success" },
  approval: { Icon: ShieldCheck, label: "Approval", className: "border-gold/50 bg-gold/15 text-gold-secondary" },
  branch: { Icon: GitBranch, label: "Decision", className: "border-danger/40 bg-danger/10 text-danger" },
  parallel_start: { Icon: Layers, label: "Split", className: "border-gold/40 bg-charcoal text-champagne" },
  parallel_join: { Icon: Merge, label: "Join", className: "border-gold/40 bg-charcoal text-champagne" },
  notification: { Icon: Zap, label: "Notify", className: "border-gold/40 bg-gold/5 text-gold-secondary" },
  end: { Icon: Flag, label: "End", className: "border-success/40 bg-success/10 text-success" },
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const edgeId = (edge: FmsGraphEdge) => `${edge.from}->${edge.to}:${edge.ruleId ?? "default"}`;

export type FmsCanvasMode = "select" | "hand";
export type FmsCanvasCommand = "copy" | "cut" | "paste" | "duplicate" | "delete" | "selectAll" | "undo" | "redo";
/** What the builder can ask the canvas: where a paste should land, and where every card currently is. */
export type FmsCanvasHandle = Readonly<{ pasteAnchor: () => FmsGraphPosition; positions: () => ReadonlyMap<string, FmsGraphPosition> }>;

type Drag =
  | Readonly<{ kind: "pan"; pointerX: number; pointerY: number; panX: number; panY: number; moved: boolean }>
  | Readonly<{ kind: "node"; keys: readonly string[]; origins: ReadonlyMap<string, FmsGraphPosition>; worldX: number; worldY: number; moved: boolean; primary: string; additive: boolean }>
  | Readonly<{ kind: "connect"; from: string }>
  | Readonly<{ kind: "reconnect"; from: string; to: string; ruleId?: string | undefined }>
  | Readonly<{ kind: "marquee"; additive: boolean; base: readonly string[]; startX: number; startY: number; moved: boolean }>;

type Box = Readonly<{ x: number; y: number; width: number; height: number }>;
type Menu = Readonly<{ x: number; y: number; world: FmsGraphPosition; kind: "node" | "canvas" | "edge"; key?: string | undefined; edge?: string | undefined }>;
type Retarget = Readonly<{ from: string; to: string; ruleId?: string | undefined }>;

/** A step touched by or inside the rectangle is selected. */
const overlaps = (point: FmsGraphPosition, box: Box) =>
  point.x < box.x + box.width && point.x + NODE_WIDTH > box.x && point.y < box.y + box.height && point.y + NODE_HEIGHT > box.y;

/** Elements whose own wheel scrolling must keep working inside the canvas. */
const WHEEL_EXEMPT = "input, select, textarea, [data-canvas-scroll]";

const readTipSeen = () => { try { return window.localStorage.getItem(TIP_KEY) === "1"; } catch { return true; } };
const writeTipSeen = () => { try { window.localStorage.setItem(TIP_KEY, "1"); } catch { /* storage unavailable: the tip simply shows again */ } };

type CanvasProps = Readonly<{
  definition: FmsFlowDefinition;
  /** The linked Forms' questions, so a route edge reads as its question and answer labels. */
  formFields: Readonly<Record<string, readonly FmsFormFieldRef[]>>;
  /** Steps selected on the canvas (one or many). Owned by the builder so copy, paste and bulk actions share it. */
  selectedKeys: readonly string[];
  onSelectionChange: (keys: readonly string[]) => void;
  /** The step open in the inspector, if any. */
  inspectedKey: string | null;
  focusRequest?: Readonly<{ key: string; id: number }> | null;
  invalidKeys: ReadonlySet<string>;
  /** A plain click or tap on a step: select only it and open its settings. */
  onOpen: (key: string) => void;
  onCommand: (command: FmsCanvasCommand, options?: Readonly<{ anchor?: FmsGraphPosition | undefined; text?: string | undefined }>) => void;
  onDelete: (key: string) => void;
  onDuplicate: (key: string) => void;
  onAddAfter: (key: string) => void;
  onConnect: (from: string, to: string) => void;
  onDisconnect: (from: string, to: string, ruleId?: string) => void;
  onReconnect: (from: string, previousTo: string, nextTo: string, ruleId?: string) => void;
  onMove: (positions: Readonly<Record<string, FmsGraphPosition>>) => void;
  /** Opens the route's full editor: the source step's settings, focused on that route. */
  onEditRoute?: ((from: string, ruleId: string | undefined) => void) | undefined;
  /** Fill the parent workspace edge to edge (desktop builder) instead of the bounded card. */
  fill?: boolean;
}>;

export const FmsGraphCanvas = forwardRef<FmsCanvasHandle, CanvasProps>(function FmsGraphCanvas(props, handleRef) {
  const { definition, formFields, selectedKeys, onSelectionChange, inspectedKey, focusRequest, invalidKeys, fill = false } = props;
  /** Handlers change on every builder render; cards read them through a ref so they never re-render for it. */
  const actions = useRef(props);
  actions.current = props;
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const hasCenteredRef = useRef(false);
  const layout = useMemo(() => layoutFmsDefinition(definition), [definition]);
  const edges = useMemo(() => fmsGraphEdges(definition.stages, formFields), [definition.stages, formFields]);
  const [offsets, setOffsets] = useState<Record<string, FmsGraphPosition>>({});
  /** Pan and zoom live together so a pointer-anchored zoom is one consistent update. */
  const [camera, setCamera] = useState<FmsViewport>({ x: 0, y: 0, zoom: 1 });
  const pan = camera;
  const zoom = camera.zoom;
  const isPhone = useIsMobile();
  /** Select is the desktop default (n8n-style); a phone starts in Hand so one finger moves around. */
  const [mode, setMode] = useState<FmsCanvasMode>(() => isPhone ? "hand" : "select");
  const [spaceDown, setSpaceDown] = useState(false);
  const spaceRef = useRef(false);
  const [connecting, setConnecting] = useState<Readonly<{ from: string; x: number; y: number }> | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [edgeInfo, setEdgeInfo] = useState(false);
  const [retarget, setRetarget] = useState<Retarget | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [marqueeKeys, setMarqueeKeys] = useState<readonly string[] | null>(null);
  /** The rectangle's latest result, readable at pointer-up before React re-renders. */
  const marqueeKeysRef = useRef<readonly string[] | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [tipOpen, setTipOpen] = useState(() => !readTipSeen());
  const lastFocusedIssueId = useRef<number | null>(null);
  const lastPointerWorld = useRef<FmsGraphPosition | null>(null);
  /** Live touch points, so two fingers become a pinch instead of two competing drags. */
  const pointersRef = useRef(new Map<number, FmsGraphPosition>());
  const pinchRef = useRef<Readonly<{ distance: number; zoom: number; worldX: number; worldY: number }> | null>(null);
  const longPressRef = useRef<{ timer: number; fired: boolean } | null>(null);
  /** Pointer moves are applied once per animation frame, so a fast drag never queues a render per event. */
  const moveFrame = useRef<{ frame: number | null; clientX: number; clientY: number }>({ frame: null, clientX: 0, clientY: 0 });

  const stageKeys = useMemo(() => new Set(definition.stages.map((stage) => stage.key)), [definition.stages]);
  useEffect(() => setOffsets((current) => { const kept = Object.entries(current).filter(([key]) => stageKeys.has(key)); return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept); }), [stageKeys]);
  useEffect(() => { if (selectedEdge && !edges.some((edge) => edgeId(edge) === selectedEdge)) setSelectedEdge(null); }, [edges, selectedEdge]);

  const saved = useMemo(() => new Map(definition.stages.flatMap((stage) => stage.position ? [[stage.key, stage.position] as const] : [])), [definition.stages]);

  /** A stage keeps its saved coordinates; without them it falls back to the computed layout. */
  const position = useCallback((key: string): FmsGraphPosition => {
    const base = saved.get(key) ?? layout.get(key) ?? { x: 60, y: 60 };
    const offset = offsets[key] ?? { x: 0, y: 0 };
    // A card being dragged may go past the left or top edge; the drop shifts the layout back (see endPointer).
    return { x: base.x + offset.x, y: base.y + offset.y };
  }, [layout, offsets, saved]);

  const positionMap = useMemo(() => new Map(definition.stages.map((stage) => [stage.key, position(stage.key)])), [definition.stages, position]);
  const routedEdges = useMemo(() => routeFmsGraphEdges(edges.map((edge) => ({ ...edge, id: edgeId(edge) })), positionMap, { width: NODE_WIDTH, height: NODE_HEIGHT }), [edges, positionMap]);
  const routeById = useMemo(() => new Map(routedEdges.map((edge) => [edge.id, edge])), [routedEdges]);
  const worldWidth = Math.max(WORLD_SIZE, ...[...positionMap.values()].map((point) => point.x + NODE_WIDTH + 120), ...routedEdges.map((edge) => edge.bounds.right + 80));
  const worldHeight = Math.max(WORLD_SIZE, ...[...positionMap.values()].map((point) => point.y + NODE_HEIGHT + 120), ...routedEdges.map((edge) => edge.bounds.bottom + 80));
  const edgeDetails = edges.find((edge) => edgeId(edge) === selectedEdge);
  const nameOf = (key: string) => definition.stages.find((stage) => stage.key === key)?.name || key;
  const selection = marqueeKeys ?? selectedKeys;
  const selectedSet = useMemo(() => new Set(selection), [selection]);

  /** Client coordinates translated into canvas-world coordinates at the current pan/zoom. */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: ((clientX - (rect?.left ?? 0)) - pan.x) / zoom, y: ((clientY - (rect?.top ?? 0)) - pan.y) / zoom };
  }, [pan.x, pan.y, zoom]);

  useImperativeHandle(handleRef, () => ({
    /** Under the pointer when it is over the canvas, otherwise the middle of what is visible. */
    pasteAnchor: () => {
      const viewport = viewportRef.current;
      if (lastPointerWorld.current) return lastPointerWorld.current;
      return { x: Math.max(0, ((viewport?.clientWidth ?? 800) / 2 - pan.x) / zoom - NODE_WIDTH / 2), y: Math.max(0, ((viewport?.clientHeight ?? 600) / 2 - pan.y) / zoom - NODE_HEIGHT / 2) };
    },
    positions: () => positionMap,
  }), [pan.x, pan.y, positionMap, zoom]);

  const fitView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !definition.stages.length) return false;
    const points = [...positionMap.values()];
    const left = Math.min(...points.map((point) => point.x), ...routedEdges.map((edge) => edge.bounds.left));
    const right = Math.max(...points.map((point) => point.x + NODE_WIDTH), ...routedEdges.map((edge) => edge.bounds.right));
    const top = Math.min(...points.map((point) => point.y), ...routedEdges.map((edge) => edge.bounds.top));
    const bottom = Math.max(...points.map((point) => point.y + NODE_HEIGHT), ...routedEdges.map((edge) => edge.bounds.bottom));
    if (!viewport.clientWidth || !viewport.clientHeight) return false;
    const next = clamp(Math.min((viewport.clientWidth - FIT_PADDING) / Math.max(1, right - left), (viewport.clientHeight - FIT_PADDING) / Math.max(1, bottom - top)), MIN_ZOOM, 1);
    setCamera({ x: viewport.clientWidth / 2 - ((left + right) / 2) * next, y: viewport.clientHeight / 2 - ((top + bottom) / 2) * next, zoom: next });
    return true;
  }, [definition.stages.length, positionMap, routedEdges]);

  /**
   * Fit once, when the workflow first has a size to fit into. The workspace is
   * sized after mount, so the first fit waits for a real viewport; later
   * resizes (a drawer, the inspector, the app sidebar) never move the camera.
   */
  const fitOnce = useCallback(() => { if (!hasCenteredRef.current && definition.stages.length && fitView()) hasCenteredRef.current = true; }, [definition.stages.length, fitView]);
  useLayoutEffect(fitOnce, [fitOnce]);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fitOnce());
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitOnce]);

  useEffect(() => {
    if (!focusRequest || lastFocusedIssueId.current === focusRequest.id || !stageKeys.has(focusRequest.key)) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const point = position(focusRequest.key);
    setCamera((current) => ({ ...current, x: viewport.clientWidth / 2 - (point.x + NODE_WIDTH / 2) * current.zoom, y: viewport.clientHeight / 2 - (point.y + NODE_HEIGHT / 2) * current.zoom }));
    lastFocusedIssueId.current = focusRequest.id;
  }, [focusRequest, stageKeys, position]);

  /** Zooms around a viewport point so the content under the pointer stays put. */
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const anchorX = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const anchorY = clientY === undefined ? rect.height / 2 : clientY - rect.top;
    setCamera((current) => zoomFmsViewport(current, { x: anchorX, y: anchorY }, current.zoom * factor));
  }, []);

  /**
   * Scroll up zooms in and scroll down zooms out, around the pointer, with no
   * modifier and in either mode. Events within one animation frame fold into
   * one update. The listener is native and non-passive because a React wheel
   * handler cannot stop the page scrolling.
   */
  const wheelRef = useRef<{ factor: number; clientX: number; clientY: number; frame: number | null }>({ factor: 1, clientX: 0, clientY: 0, frame: null });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const pending = wheelRef.current;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement | null)?.closest?.(WHEEL_EXEMPT)) return;
      event.preventDefault();
      pending.factor *= fmsWheelZoomFactor(event, viewport.clientHeight);
      pending.clientX = event.clientX; pending.clientY = event.clientY;
      if (pending.frame !== null) return;
      pending.frame = requestAnimationFrame(() => {
        pending.frame = null;
        const factor = pending.factor; pending.factor = 1;
        if (factor !== 1) zoomAt(factor, pending.clientX, pending.clientY);
      });
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => { viewport.removeEventListener("wheel", onWheel); if (pending.frame !== null) cancelAnimationFrame(pending.frame); pending.frame = null; pending.factor = 1; };
  }, [zoomAt]);

  const closeTransient = useCallback(() => { setMenu(null); setRetarget(null); setSelectedEdge(null); setEdgeInfo(false); }, []);

  /**
   * Editor shortcuts, active only while the canvas (or nothing in particular)
   * has focus: typing in an input, a select, the inspector or a dialog keeps
   * the browser's own copy, paste, delete and undo.
   */
  useEffect(() => {
    let pastePending: number | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!fmsShortcutContext(event.target, viewportRef.current)) return;
      const command = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const run = (name: FmsCanvasCommand) => { event.preventDefault(); actions.current.onCommand(name, { anchor: lastPointerWorld.current ?? undefined }); };
      if (event.key === " " && !command) { event.preventDefault(); if (!spaceRef.current) { spaceRef.current = true; setSpaceDown(true); } return; }
      if (command && key === "z") { run(event.shiftKey ? "redo" : "undo"); return; }
      if (command && key === "y") { run("redo"); return; }
      if (command && key === "a") { run("selectAll"); return; }
      if (command && key === "d") { run("duplicate"); return; }
      if (command && (key === "c" || key === "x")) {
        if (window.getSelection?.()?.toString()) return;
        if (!actions.current.selectedKeys.length) return;
        run(key === "c" ? "copy" : "cut");
        return;
      }
      if (command && key === "v") {
        // The browser's paste event carries the clipboard text without a permission
        // prompt; if it never arrives (some browsers skip it off an input), fall back.
        if (pastePending !== null) window.clearTimeout(pastePending);
        pastePending = window.setTimeout(() => { pastePending = null; actions.current.onCommand("paste", { anchor: lastPointerWorld.current ?? undefined }); }, 60);
        return;
      }
      if (command || event.altKey) return;
      if (event.key === "Escape") { closeTransient(); actions.current.onSelectionChange([]); return; }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const edge = edges.find((item) => edgeId(item) === selectedEdge);
        if (edge) { actions.current.onDisconnect(edge.from, edge.to, edge.ruleId); setSelectedEdge(null); return; }
        if (actions.current.selectedKeys.length) actions.current.onCommand("delete");
        return;
      }
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomAt(ZOOM_STEP); }
      else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomAt(1 / ZOOM_STEP); }
      else if (event.key === "0") { event.preventDefault(); setCamera((current) => zoomFmsViewport(current, { x: (viewportRef.current?.clientWidth ?? 0) / 2, y: (viewportRef.current?.clientHeight ?? 0) / 2 }, 1)); }
      else if (event.key === "1") { event.preventDefault(); fitView(); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === " " && spaceRef.current) { spaceRef.current = false; setSpaceDown(false); } };
    const onBlur = () => { spaceRef.current = false; setSpaceDown(false); };
    const onPaste = (event: ClipboardEvent) => {
      if (!fmsShortcutContext(event.target, viewportRef.current)) return;
      if (pastePending !== null) { window.clearTimeout(pastePending); pastePending = null; }
      event.preventDefault();
      actions.current.onCommand("paste", { anchor: lastPointerWorld.current ?? undefined, text: event.clipboardData?.getData("text/plain") ?? undefined });
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("paste", onPaste);
    window.addEventListener("blur", onBlur);
    return () => {
      if (pastePending !== null) window.clearTimeout(pastePending);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("paste", onPaste);
      window.removeEventListener("blur", onBlur);
    };
  }, [closeTransient, edges, fitView, selectedEdge, zoomAt]);

  const nodeKeyAt = (clientX: number, clientY: number) =>
    (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-node-key]")?.dataset.nodeKey ?? null;

  const cancelLongPress = () => { if (longPressRef.current) window.clearTimeout(longPressRef.current.timer); };

  /** Two fingers down: drop whatever the first finger started and zoom around their midpoint. */
  const startPinch = () => {
    const [first, second] = [...pointersRef.current.values()];
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!first || !second || !rect) return;
    cancelLongPress();
    dragRef.current = null; setConnecting(null); setDropTarget(null); setMarquee(null); setMarqueeKeys(null); marqueeKeysRef.current = null; setOffsets({});
    const midX = (first.x + second.x) / 2 - rect.left; const midY = (first.y + second.y) / 2 - rect.top;
    pinchRef.current = { distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), zoom, worldX: (midX - pan.x) / zoom, worldY: (midY - pan.y) / zoom };
  };

  const beginPan = (clientX: number, clientY: number) => { dragRef.current = { kind: "pan", pointerX: clientX, pointerY: clientY, panX: pan.x, panY: pan.y, moved: false }; };

  const beginPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-canvas-control]")) return;
    if (menu) setMenu(null);
    viewportRef.current?.focus({ preventScroll: true });
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) { event.currentTarget.setPointerCapture(event.pointerId); startPinch(); return; }
    if (event.button === 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    // Middle button, Space held, or Hand mode: the canvas moves whatever was pressed.
    if (event.button === 1 || spaceRef.current) { event.preventDefault(); beginPan(event.clientX, event.clientY); return; }
    const endpoint = target.closest<HTMLElement>("[data-edge-from]");
    if (endpoint?.dataset.edgeFrom && endpoint.dataset.edgeTo) {
      const from = endpoint.dataset.edgeFrom;
      const point = position(from);
      dragRef.current = { kind: "reconnect", from, to: endpoint.dataset.edgeTo, ruleId: endpoint.dataset.edgeRule || undefined };
      setConnecting({ from, x: point.x + NODE_WIDTH, y: point.y + NODE_HEIGHT / 2 });
      return;
    }
    const edgeHit = target.closest<SVGElement>("[data-edge-hit]")?.dataset.edgeHit;
    if (edgeHit) { setSelectedEdge(edgeHit); setEdgeInfo(false); setHoveredEdge(edgeHit); dragRef.current = null; return; }
    setSelectedEdge(null);
    const handle = target.closest<HTMLElement>("[data-node-output]");
    if (handle?.dataset.nodeOutput) {
      const from = handle.dataset.nodeOutput;
      const point = position(from);
      dragRef.current = { kind: "connect", from };
      setConnecting({ from, x: point.x + NODE_WIDTH, y: point.y + NODE_HEIGHT / 2 });
      return;
    }
    const card = target.closest<HTMLElement>("[data-node-key]");
    if (card?.dataset.nodeKey && event.button === 0) {
      const key = card.dataset.nodeKey;
      const world = toWorld(event.clientX, event.clientY);
      // While choosing a route's new destination, the click picks the step on release.
      if (retarget) { dragRef.current = { kind: "node", keys: [], origins: new Map(), worldX: world.x, worldY: world.y, moved: false, primary: key, additive: false }; return; }
      const additive = event.shiftKey || event.ctrlKey || event.metaKey;
      const current = actions.current.selectedKeys;
      const chosen = additive ? (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]) : (current.includes(key) ? current : [key]);
      if (additive || !current.includes(key)) onSelectionChange(chosen);
      const keys = chosen.includes(key) ? chosen : [];
      dragRef.current = { kind: "node", keys, origins: new Map(keys.map((item) => [item, position(item)])), worldX: world.x, worldY: world.y, moved: false, primary: key, additive };
      if (event.pointerType !== "mouse") {
        // A long press adds the step to the selection, the phone's Shift+click.
        const timer = window.setTimeout(() => {
          const drag = dragRef.current;
          if (drag?.kind !== "node" || drag.moved) return;
          longPressRef.current = { timer, fired: true };
          const latest = actions.current.selectedKeys;
          onSelectionChange(latest.includes(key) && latest.length > 1 ? latest : [...new Set([...latest, key])]);
          navigator.vibrate?.(12);
        }, LONG_PRESS_MS);
        longPressRef.current = { timer, fired: false };
      }
      return;
    }
    if (event.button !== 0) return;
    if (mode === "hand") { beginPan(event.clientX, event.clientY); return; }
    const world = toWorld(event.clientX, event.clientY);
    dragRef.current = { kind: "marquee", additive: event.shiftKey || event.ctrlKey || event.metaKey, base: actions.current.selectedKeys, startX: world.x, startY: world.y, moved: false };
  };

  const applyMove = (clientX: number, clientY: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      const moved = drag.moved || Math.hypot(clientX - drag.pointerX, clientY - drag.pointerY) >= DRAG_THRESHOLD;
      if (moved !== drag.moved) dragRef.current = { ...drag, moved };
      setCamera((current) => ({ ...current, x: drag.panX + (clientX - drag.pointerX), y: drag.panY + (clientY - drag.pointerY) }));
      return;
    }
    const world = toWorld(clientX, clientY);
    if (drag.kind === "marquee") {
      if (!drag.moved && Math.hypot((world.x - drag.startX) * zoom, (world.y - drag.startY) * zoom) < DRAG_THRESHOLD) return;
      if (!drag.moved) dragRef.current = { ...drag, moved: true };
      const box = { x: Math.min(drag.startX, world.x), y: Math.min(drag.startY, world.y), width: Math.abs(world.x - drag.startX), height: Math.abs(world.y - drag.startY) };
      setMarquee(box);
      const inside = definition.stages.filter((stage) => overlaps(position(stage.key), box)).map((stage) => stage.key);
      marqueeKeysRef.current = drag.additive ? [...new Set([...drag.base, ...inside])] : inside;
      setMarqueeKeys(marqueeKeysRef.current);
      return;
    }
    if (drag.kind === "connect" || drag.kind === "reconnect") {
      setConnecting((current) => current ? { ...current, x: world.x, y: world.y } : current);
      const hovered = nodeKeyAt(clientX, clientY);
      setDropTarget(hovered && hovered !== drag.from ? hovered : null);
      return;
    }
    const dx = world.x - drag.worldX;
    const dy = world.y - drag.worldY;
    if (!drag.moved && Math.hypot(dx * zoom, dy * zoom) < DRAG_THRESHOLD) return;
    if (!drag.moved) { cancelLongPress(); dragRef.current = { ...drag, moved: true }; }
    if (!drag.keys.length) return;
    setOffsets((current) => {
      const next = { ...current };
      for (const key of drag.keys) {
        const base = saved.get(key) ?? layout.get(key) ?? { x: 60, y: 60 };
        const origin = drag.origins.get(key) ?? base;
        next[key] = { x: origin.x + dx - base.x, y: origin.y + dy - base.y };
      }
      return next;
    });
  };

  const flushMove = () => {
    const pending = moveFrame.current;
    if (pending.frame === null) return;
    cancelAnimationFrame(pending.frame);
    pending.frame = null;
    applyMove(pending.clientX, pending.clientY);
  };

  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (viewportRef.current?.contains(event.target as Node)) lastPointerWorld.current = toWorld(event.clientX, event.clientY);
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = pinchRef.current;
    if (pinch) {
      const [first, second] = [...pointersRef.current.values()];
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!first || !second || !rect) return;
      const next = clamp(pinch.zoom * (Math.hypot(first.x - second.x, first.y - second.y) / pinch.distance), MIN_ZOOM, MAX_ZOOM);
      const midX = (first.x + second.x) / 2 - rect.left; const midY = (first.y + second.y) / 2 - rect.top;
      setCamera({ x: midX - pinch.worldX * next, y: midY - pinch.worldY * next, zoom: next });
      return;
    }
    if (!dragRef.current) return;
    const pending = moveFrame.current;
    pending.clientX = event.clientX; pending.clientY = event.clientY;
    if (pending.frame !== null) return;
    pending.frame = requestAnimationFrame(() => { pending.frame = null; applyMove(pending.clientX, pending.clientY); });
  };

  const endPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    // A pinch ends the gesture outright; the finger still down does not turn into a drag.
    if (pinchRef.current) { if (pointersRef.current.size === 0) pinchRef.current = null; dragRef.current = null; return; }
    flushMove();
    cancelLongPress();
    const longPressed = longPressRef.current?.fired ?? false;
    longPressRef.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === "pan") { if (!drag.moved && event.button !== 1 && !spaceRef.current) { closeTransient(); onSelectionChange([]); } return; }
    if (drag.kind === "marquee") {
      const chosen = marqueeKeysRef.current;
      marqueeKeysRef.current = null;
      setMarquee(null); setMarqueeKeys(null);
      if (drag.moved && chosen) onSelectionChange(chosen);
      else if (!drag.additive) { closeTransient(); onSelectionChange([]); }
      return;
    }
    if (drag.kind === "connect" || drag.kind === "reconnect") {
      const target = nodeKeyAt(event.clientX, event.clientY);
      if (target) {
        if (drag.kind === "connect") actions.current.onConnect(drag.from, target);
        else if (target !== drag.to) actions.current.onReconnect(drag.from, drag.to, target, drag.ruleId);
      }
      setConnecting(null); setDropTarget(null);
      return;
    }
    if (!drag.moved) {
      if (retarget) {
        if (drag.primary !== retarget.from && drag.primary !== retarget.to) actions.current.onReconnect(retarget.from, retarget.to, drag.primary, retarget.ruleId);
        setRetarget(null);
        return;
      }
      if (!drag.additive && !longPressed) actions.current.onOpen(drag.primary);
      return;
    }
    if (!drag.keys.length) return;
    // One commit (one undo step) for the whole group, at its final resting place.
    const world = toWorld(event.clientX, event.clientY);
    const dx = world.x - drag.worldX; const dy = world.y - drag.worldY;
    const moved = Object.fromEntries(drag.keys.map((key) => { const origin = drag.origins.get(key) ?? position(key); return [key, { x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) }]; }));
    // Saved positions cannot be negative, so a drop past the left or top edge
    // moves every card by the overshoot and the camera by the same amount:
    // nothing jumps on screen and the canvas has no wall.
    const shift = fmsCanvasOvershoot(Object.values(moved));
    if (shift.x || shift.y) {
      actions.current.onMove(Object.fromEntries(definition.stages.map((stage) => { const point = moved[stage.key] ?? position(stage.key); return [stage.key, { x: point.x + shift.x, y: point.y + shift.y }]; })));
      setCamera((current) => ({ ...current, x: current.x - shift.x * current.zoom, y: current.y - shift.y * current.zoom }));
    } else actions.current.onMove(moved);
    setOffsets((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !drag.keys.includes(key))));
  };

  const cancelPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) pinchRef.current = null;
    cancelLongPress(); longPressRef.current = null;
    if (moveFrame.current.frame !== null) { cancelAnimationFrame(moveFrame.current.frame); moveFrame.current.frame = null; }
    dragRef.current = null; setConnecting(null); setDropTarget(null); setMarquee(null); setMarqueeKeys(null); setOffsets({});
  };

  const openMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-canvas-control]") || target.closest("input, textarea, select")) return;
    event.preventDefault();
    const rect = viewportRef.current?.getBoundingClientRect();
    const local = { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
    const world = toWorld(event.clientX, event.clientY);
    const key = target.closest<HTMLElement>("[data-node-key]")?.dataset.nodeKey;
    const edge = target.closest<SVGElement>("[data-edge-hit]")?.dataset.edgeHit;
    if (key && !selectedKeys.includes(key)) onSelectionChange([key]);
    if (edge) setSelectedEdge(edge);
    setMenu({ ...local, world, kind: key ? "node" : edge ? "edge" : "canvas", key, edge });
  };

  const curve = (startX: number, startY: number, endX: number, endY: number) => {
    const bend = Math.max(48, Math.abs(endX - startX) / 2);
    return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
  };

  const viewportWidth = viewportRef.current?.clientWidth ?? 0;
  const toScreen = (point: FmsGraphPosition) => ({ x: pan.x + point.x * zoom, y: pan.y + point.y * zoom });
  /** The bulk toolbar sits just above the selection, kept inside the canvas. */
  const selectionBar = selectedKeys.length > 1 || (selectedKeys.length === 1 && isPhone && mode === "select") ? (() => {
    const points = selectedKeys.map((key) => positionMap.get(key)).filter((point): point is FmsGraphPosition => !!point);
    if (!points.length) return null;
    const left = toScreen({ x: Math.min(...points.map((point) => point.x)), y: Math.min(...points.map((point) => point.y)) });
    const right = toScreen({ x: Math.max(...points.map((point) => point.x + NODE_WIDTH)), y: 0 });
    return { x: clamp((left.x + right.x) / 2, 120, Math.max(120, viewportWidth - 120)), y: Math.max(56, left.y - 12) };
  })() : null;
  const edgePopover = edgeDetails && !connecting ? (() => {
    const route = routeById.get(edgeId(edgeDetails));
    if (!route) return null;
    const point = toScreen(route.label);
    return { x: clamp(point.x, 110, Math.max(110, viewportWidth - 110)), y: Math.max(48, point.y - 16) };
  })() : null;
  const command = (name: FmsCanvasCommand, anchor?: FmsGraphPosition) => { setMenu(null); actions.current.onCommand(name, { anchor }); };
  const canvasCursor = connecting || retarget ? "cursor-crosshair" : spaceDown || mode === "hand" ? "cursor-grab active:cursor-grabbing" : "cursor-default";
  const dismissTip = () => { writeTipSeen(); setTipOpen(false); };

  return <div
    aria-label="Workflow canvas"
    className={cn("relative touch-none select-none overflow-hidden bg-obsidian outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-gold", fill ? "h-full min-h-0 w-full" : "h-[calc(100dvh-17rem)] min-h-[20rem] rounded-2xl border border-gold/20 md:h-[calc(100dvh-19rem)] md:min-h-[34rem]")}
    data-canvas-mode={mode}
    onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
    onContextMenu={openMenu}
    onPointerCancel={cancelPointer}
    onPointerDown={beginPointer}
    onPointerLeave={() => { if (!dragRef.current) lastPointerWorld.current = null; }}
    onPointerMove={movePointer}
    onPointerUp={endPointer}
    ref={viewportRef}
    role="application"
    tabIndex={0}
  >
    <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-lg border border-gold/20 bg-charcoal p-1 shadow-lg" data-canvas-control>
      <div aria-label="Canvas mode" className="flex rounded-md bg-obsidian/60" role="group">
        <button aria-label="Select mode" aria-pressed={mode === "select"} className={cn("rounded p-2 max-md:p-2.5", mode === "select" ? "bg-gold/20 text-gold-secondary" : "text-soft-grey hover:text-gold-secondary")} onClick={() => setMode("select")} title={isPhone ? "Select several steps" : "Select (drag to select several)"} type="button"><MousePointer2 className="size-4" /></button>
        <button aria-label="Hand mode" aria-pressed={mode === "hand"} className={cn("rounded p-2 max-md:p-2.5", mode === "hand" ? "bg-gold/20 text-gold-secondary" : "text-soft-grey hover:text-gold-secondary")} onClick={() => setMode("hand")} title="Hand (drag to move around)" type="button"><Hand className="size-4" /></button>
      </div>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-gold/20" />
      <button aria-label="Zoom out" className="rounded p-2 text-gold-secondary hover:bg-gold/10 max-md:p-2.5" onClick={() => zoomAt(1 / ZOOM_STEP)} title="Zoom out" type="button"><Minus className="size-4" /></button>
      <span className="hidden min-w-11 place-items-center text-xs text-champagne sm:grid">{Math.round(zoom * 100)}%</span>
      <button aria-label="Zoom in" className="rounded p-2 text-gold-secondary hover:bg-gold/10 max-md:p-2.5" onClick={() => zoomAt(ZOOM_STEP)} title="Zoom in" type="button"><Plus className="size-4" /></button>
      <button aria-label="Fit workflow to view" className="rounded p-2 text-gold-secondary hover:bg-gold/10 max-md:p-2.5" onClick={fitView} title="Fit workflow (1)" type="button"><Maximize className="size-4" /></button>
      <button aria-label="Auto-arrange workflow" className="hidden rounded p-2 text-gold-secondary hover:bg-gold/10 sm:block" onClick={() => { setOffsets({}); actions.current.onMove(Object.fromEntries(layout)); }} title="Auto-arrange" type="button"><LayoutGrid className="size-4" /></button>
      <button aria-expanded={tipOpen} aria-label="Canvas tips" className={cn("rounded p-2 text-gold-secondary hover:bg-gold/10 max-md:p-2.5", tipOpen && "bg-gold/15")} onClick={() => setTipOpen((open) => !open)} title="Tips" type="button"><CircleHelp className="size-4" /></button>
    </div>
    {tipOpen ? <div className="absolute left-3 top-3 z-30 flex max-w-[min(26rem,calc(100%-1.5rem))] items-start gap-2 rounded-xl border border-gold/25 bg-charcoal/95 px-3 py-2 text-xs leading-relaxed text-soft-grey shadow-xl max-sm:top-16" data-canvas-control role="note">
      <MousePointer2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-gold-secondary" />
      <p className="min-w-0">{isPhone
        ? "Tap a step to edit it · pinch to zoom · drag to move around · switch to Select, then press and hold steps to pick several"
        : "Drag empty space to select steps · Space+drag or the hand to pan · scroll to zoom · drag a step's right dot to connect · right-click for actions"}</p>
      <button className="shrink-0 rounded px-1.5 font-semibold text-gold-secondary hover:bg-gold/10" onClick={dismissTip} type="button">Got it</button>
    </div> : null}

    {/* The dot grid belongs to the viewport and follows pan and zoom, so it never ends at an edge. */}
    <div className={cn("absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgba(217,184,117,0.16)_1px,transparent_0)]", canvasCursor)} style={{ backgroundPosition: `${pan.x}px ${pan.y}px`, backgroundSize: `${22 * zoom}px ${22 * zoom}px` }}>
      <div className="absolute origin-top-left" style={{ height: worldHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: worldWidth }}>
        <svg className="pointer-events-none absolute inset-0" height={worldHeight - Math.min(0, ...routedEdges.map((edge) => edge.bounds.top - 40))} width={worldWidth - Math.min(0, ...routedEdges.map((edge) => edge.bounds.left - 40))} style={{ overflow: "visible" }}>
          <defs><marker id="fms-arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M0,0 L0,7 L7,3.5 z" fill="currentColor" /></marker></defs>
          {edges.map((edge) => {
            const id = edgeId(edge); const route = routeById.get(id);
            if (!route) return null;
            const selectedRoute = selectedEdge === id;
            const active = hoveredEdge === id || selectedRoute;
            const connected = edge.from === inspectedKey || edge.to === inspectedKey;
            const midX = route.label.x; const midY = route.label.y;
            const path = route.path; const labelWidth = route.labelWidth;
            const label = `${route.isReturn ? "↩ " : ""}${edge.label ?? (route.isReturn ? "Return" : "")}`;
            const maxLabelChars = Math.max(5, Math.floor((labelWidth - 16) / 6.4));
            const description = `${route.isReturn ? "Return: " : ""}${nameOf(edge.from)} → ${nameOf(edge.to)}${edge.label ? `: ${edge.label}` : ""}`;
            return <g className={edge.kind === "branch" ? "text-danger" : edge.kind === "parallel" ? "text-champagne" : "text-gold-secondary"} key={id}>
              <path aria-label={description} aria-pressed={selectedRoute} role="button" tabIndex={0} className="cursor-pointer" d={path} data-edge-hit={id} fill="none" onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setSelectedEdge(id); setEdgeInfo(false); } }} onPointerEnter={() => setHoveredEdge(id)} onPointerLeave={(event) => { if (event.pointerType === "mouse") setHoveredEdge((current) => current === id ? null : current); }} stroke="transparent" strokeLinecap="round" strokeWidth={EDGE_HIT_PX / zoom} style={{ pointerEvents: "stroke" }}><title>{description}</title></path>
              {selectedRoute ? <path className="pointer-events-none" d={path} fill="none" stroke="currentColor" strokeOpacity={0.25} strokeWidth={8 / zoom} /> : null}
              <path className="pointer-events-none" d={path} fill="none" markerEnd="url(#fms-arrow)" stroke="currentColor" strokeDasharray={edge.kind === "parallel" ? "4 4" : undefined} strokeOpacity={active ? 1 : selectedEdge ? 0.2 : connected ? 0.95 : 0.7} strokeWidth={selectedRoute ? 2.75 : active ? 2.25 : 1.8} />
              {label ? <g className="pointer-events-none" opacity={selectedEdge && !selectedRoute ? 0.35 : 1}><rect fill="rgb(var(--color-charcoal))" height="18" rx="9" stroke="currentColor" strokeOpacity={selectedRoute ? 1 : 0.4} strokeWidth={selectedRoute ? 1.5 : 1} width={labelWidth} x={midX - labelWidth / 2} y={midY - 9} /><text fill="currentColor" fontSize="11" fontWeight={selectedRoute ? 600 : 400} textAnchor="middle" x={midX} y={midY + 4}>{label.length > maxLabelChars ? `${label.slice(0, maxLabelChars - 1)}…` : label}</text></g> : null}
              {selectedRoute ? <circle className="pointer-events-auto cursor-crosshair" cx={route.end.x - 10} cy={route.end.y} data-edge-from={edge.from} data-edge-rule={edge.ruleId ?? ""} data-edge-to={edge.to} fill="rgb(var(--color-charcoal))" r="7" stroke="currentColor" strokeWidth="2"><title>Drag to move this connection onto another step</title></circle> : null}
            </g>;
          })}
          {marquee ? <rect className="text-gold-secondary" fill="currentColor" fillOpacity="0.06" height={marquee.height} rx="4" stroke="currentColor" strokeDasharray={`${4 / zoom} ${4 / zoom}`} strokeWidth={1.25 / zoom} width={marquee.width} x={marquee.x} y={marquee.y} /> : null}
          {connecting ? <path className="text-gold-secondary" d={curve(position(connecting.from).x + NODE_WIDTH, position(connecting.from).y + NODE_HEIGHT / 2, connecting.x, connecting.y)} fill="none" markerEnd="url(#fms-arrow)" stroke="currentColor" strokeDasharray="5 5" strokeWidth="2" /> : null}
        </svg>

        {definition.stages.map((stage, index) => {
          const point = positionMap.get(stage.key) ?? { x: 60, y: 60 };
          return <StageCard
            actions={actions}
            dropTarget={dropTarget === stage.key}
            highlighted={edgeDetails?.from === stage.key || edgeDetails?.to === stage.key || retarget?.from === stage.key}
            inspected={stage.key === inspectedKey}
            invalid={invalidKeys.has(stage.key)}
            isFirst={index === 0}
            key={stage.key}
            selected={selectedSet.has(stage.key)}
            stage={stage}
            x={point.x}
            y={point.y}
          />;
        })}
      </div>
    </div>

    {selectionBar && !marquee && !dragRef.current ? <div aria-label={`${selectedKeys.length} selected`} className="absolute z-30 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-lg border border-gold/30 bg-charcoal p-1 shadow-xl" data-canvas-control role="toolbar" style={{ left: selectionBar.x, top: selectionBar.y }}>
      <span className="px-1.5 text-xs font-semibold text-champagne">{selectedKeys.length}</span>
      <ToolButton icon={Copy} label="Copy selected steps" onClick={() => command("copy")} />
      <ToolButton icon={CopyPlus} label="Duplicate selected steps" onClick={() => command("duplicate")} />
      <ToolButton icon={Scissors} label="Cut selected steps" onClick={() => command("cut")} />
      <ToolButton danger icon={Trash2} label="Delete selected steps" onClick={() => command("delete")} />
      <ToolButton icon={X} label="Clear selection" onClick={() => onSelectionChange([])} />
    </div> : null}

    {edgePopover && edgeDetails ? <div aria-label="Connection actions" className="absolute z-30 -translate-x-1/2 -translate-y-full rounded-lg border border-gold/30 bg-charcoal p-1 shadow-xl" data-canvas-control role="toolbar" style={{ left: edgePopover.x, top: edgePopover.y }}>
      <div className="flex items-center gap-0.5">
        {actions.current.onEditRoute ? <ToolButton icon={Pencil} label="Edit route" onClick={() => { actions.current.onEditRoute?.(edgeDetails.from, edgeDetails.ruleId); setSelectedEdge(null); }} /> : null}
        <ToolButton icon={Waypoints} label="Change destination" onClick={() => { setRetarget({ from: edgeDetails.from, to: edgeDetails.to, ruleId: edgeDetails.ruleId }); setSelectedEdge(null); }} />
        <ToolButton icon={Info} label="Route details" onClick={() => setEdgeInfo((open) => !open)} pressed={edgeInfo} />
        <ToolButton danger icon={Trash2} label="Delete route" onClick={() => { actions.current.onDisconnect(edgeDetails.from, edgeDetails.to, edgeDetails.ruleId); setSelectedEdge(null); }} />
      </div>
      {edgeInfo ? <div className="max-w-64 border-t border-gold/15 px-2 pb-1 pt-1.5 text-xs"><p className="font-semibold text-champagne">{nameOf(edgeDetails.from)} → {nameOf(edgeDetails.to)}</p><p className="text-soft-grey">{edgeDetails.label || (edgeDetails.kind === "parallel" ? "Runs in parallel" : "Continue to next step")}</p></div> : <p className="sr-only">{nameOf(edgeDetails.from)} → {nameOf(edgeDetails.to)}</p>}
    </div> : null}

    {menu ? <div aria-label="Canvas actions" className="absolute z-40 min-w-44 rounded-lg border border-gold/30 bg-charcoal p-1 text-sm shadow-2xl" data-canvas-control role="menu" style={{ left: clamp(menu.x, 4, Math.max(4, viewportWidth - 184)), top: menu.y }}>
      {menu.kind === "node" ? <>
        <MenuItem icon={Pencil} label="Open settings" onClick={() => { setMenu(null); if (menu.key) actions.current.onOpen(menu.key); }} />
        <MenuItem icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => command("copy")} />
        <MenuItem icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => command("cut")} />
        <MenuItem icon={CopyPlus} label="Duplicate" shortcut="Ctrl+D" onClick={() => command("duplicate")} />
        <MenuItem danger icon={Trash2} label="Delete" shortcut="Del" onClick={() => command("delete")} />
      </> : menu.kind === "edge" && edgeDetails ? <>
        {actions.current.onEditRoute ? <MenuItem icon={Pencil} label="Edit route" onClick={() => { setMenu(null); actions.current.onEditRoute?.(edgeDetails.from, edgeDetails.ruleId); }} /> : null}
        <MenuItem icon={Waypoints} label="Change destination" onClick={() => { setMenu(null); setRetarget({ from: edgeDetails.from, to: edgeDetails.to, ruleId: edgeDetails.ruleId }); setSelectedEdge(null); }} />
        <MenuItem danger icon={Trash2} label="Delete route" onClick={() => { setMenu(null); actions.current.onDisconnect(edgeDetails.from, edgeDetails.to, edgeDetails.ruleId); setSelectedEdge(null); }} />
      </> : <>
        <MenuItem icon={ClipboardPaste} label="Paste here" shortcut="Ctrl+V" onClick={() => command("paste", menu.world)} />
        <MenuItem icon={MousePointer2} label="Select all" shortcut="Ctrl+A" onClick={() => command("selectAll")} />
        <MenuItem icon={Maximize} label="Fit workflow" shortcut="1" onClick={() => { setMenu(null); fitView(); }} />
      </>}
    </div> : null}

    {retarget ? <p className="absolute bottom-[var(--fms-canvas-overlay-bottom,0.75rem)] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-gold/40 bg-charcoal px-3 py-1.5 text-xs text-gold-secondary shadow-lg" data-canvas-control>Click the step this route should go to<button className="font-semibold underline" onClick={() => setRetarget(null)} type="button">Cancel</button></p> : null}
    {connecting ? <p className="pointer-events-none absolute bottom-[var(--fms-canvas-overlay-bottom,0.75rem)] right-4 z-30 rounded-full border border-gold/40 bg-charcoal px-3 py-1 text-xs text-gold-secondary">Drop on a step to connect &middot; release on empty space to cancel</p> : null}
  </div>;
});

function ToolButton({ icon: Icon, label, onClick, danger = false, pressed }: { icon: typeof Copy; label: string; onClick: () => void; danger?: boolean; pressed?: boolean | undefined }) {
  return <button aria-label={label} aria-pressed={pressed} className={cn("grid size-8 place-items-center rounded-md transition max-md:size-10", danger ? "text-soft-grey hover:bg-danger/10 hover:text-danger" : "text-soft-grey hover:bg-gold/10 hover:text-gold-secondary", pressed && "bg-gold/15 text-gold-secondary")} onClick={onClick} title={label} type="button"><Icon className="size-4" /></button>;
}

function MenuItem({ icon: Icon, label, shortcut, onClick, danger = false }: { icon: typeof Copy; label: string; shortcut?: string; onClick: () => void; danger?: boolean }) {
  return <button className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left", danger ? "text-danger hover:bg-danger/10" : "text-champagne hover:bg-gold/10")} onClick={onClick} role="menuitem" type="button"><Icon className="size-4 shrink-0" /><span className="flex-1">{label}</span>{shortcut ? <kbd className="text-[10px] text-soft-grey">{shortcut}</kbd> : null}</button>;
}

/**
 * One workflow step. Memoised on its own data and position, so dragging one
 * step or panning re-renders only what moved, even in a 100-step workflow.
 */
const StageCard = memo(function StageCard({ stage, x, y, selected, inspected, highlighted, invalid, dropTarget, isFirst, actions }: {
  stage: FmsStageDefinition; x: number; y: number; selected: boolean; inspected: boolean; highlighted: boolean; invalid: boolean; dropTarget: boolean; isFirst: boolean;
  actions: Readonly<{ current: Pick<CanvasProps, "onDuplicate" | "onDelete" | "onAddAfter"> }>;
}) {
  const item = appearance[stage.type];
  const canOutput = stage.type !== "end";
  const canAppend = !["end", "branch", "parallel_start"].includes(stage.type);
  const isLeaf = fmsOutgoingStageKeys(stage).length === 0 && stage.type !== "end";
  const routed = hasFmsStageRouting(stage) || stage.type === "branch";
  // A step is labelled by what it is; ordinary steps carry no "Normal step" badge.
  const badge = stage.type === "task" ? null : item.label;
  return <article
    aria-label={stage.name || "Untitled stage"}
    aria-selected={selected}
    className={cn(
      "absolute cursor-grab select-none rounded-xl border p-3 text-left shadow-lg transition-colors active:cursor-grabbing",
      selected ? "border-gold bg-charcoal outline outline-2 outline-offset-2 outline-gold/70" : inspected || highlighted ? "border-gold bg-charcoal" : "border-gold/25 bg-charcoal/95 hover:border-gold/70",
      invalid && "border-danger",
      dropTarget && "border-success outline outline-2 outline-success",
    )}
    data-node-key={stage.key}
    style={{ height: NODE_HEIGHT, left: x, top: y, width: NODE_WIDTH }}
  >
    {isFirst ? <span className="pointer-events-none absolute -top-7 left-0 rounded-md border border-gold/30 bg-charcoal px-2 py-1 text-[10px] font-semibold text-gold-secondary">Starts here</span> : null}
    {isLeaf ? <span className="pointer-events-none absolute -bottom-7 left-0 rounded-md border border-success/30 bg-charcoal px-2 py-1 text-[10px] font-semibold text-success">Completes here</span> : null}
    <div className="mb-1.5 flex h-6 items-center justify-between gap-1">
      {badge ? <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", item.className)}><item.Icon className="size-3" />{badge}</span> : <item.Icon aria-hidden className="size-4 text-gold-secondary" />}
      <span className="flex gap-0.5" data-canvas-control>
        <button aria-label={`Duplicate ${stage.name}`} className="rounded p-1 text-soft-grey hover:bg-gold/10 hover:text-gold-secondary" onClick={() => actions.current.onDuplicate(stage.key)} title="Duplicate" type="button"><Copy className="size-3.5" /></button>
        <button aria-label={`Delete ${stage.name}`} className="rounded p-1 text-soft-grey hover:bg-danger/10 hover:text-danger" onClick={() => actions.current.onDelete(stage.key)} title="Delete" type="button"><Trash2 className="size-3.5" /></button>
      </span>
    </div>
    <span className="block truncate text-sm font-semibold text-white" title={stage.sla.pipelineName ? `${stage.sla.pipelineName} / ${stage.name}` : stage.name}>{stage.sla.pipelineName ? `${stage.sla.pipelineName} / ` : ""}{stage.name || "Untitled stage"}</span>
    <span className="mt-1 block truncate text-xs text-soft-grey">{fmsStageSummary(stage)} &middot; {fmsTimingSummary(stage)}</span>
    {invalid ? <span className="mt-1 block truncate text-xs font-medium text-danger">Needs attention</span> : null}
    <span aria-hidden="true" className="pointer-events-none absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-charcoal bg-gold/70" />
    {canOutput ? <button
      aria-label={`Drag to connect ${stage.name} to another step`}
      className="absolute -right-4 top-1/2 grid size-8 -translate-y-1/2 cursor-crosshair place-items-center rounded-full"
      data-node-output={stage.key}
      type="button"
    ><span className={cn("size-4 rounded-full border-2 border-charcoal shadow transition hover:scale-125", routed ? "bg-danger" : "bg-gold")} /></button> : null}
    {canAppend ? <button aria-label={`Add next step after ${stage.name}`} className="absolute -right-14 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-gold/40 bg-charcoal text-gold-secondary shadow transition hover:bg-gold hover:text-on-gold" data-canvas-control onClick={() => actions.current.onAddAfter(stage.key)} type="button"><Plus className="size-4" /></button> : null}
  </article>;
});
