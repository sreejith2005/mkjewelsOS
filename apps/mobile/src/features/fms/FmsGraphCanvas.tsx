import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, StyleSheet, View, type GestureResponderEvent, type NativeTouchEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { G, Path, Polygon, Rect, Text as SvgText } from "react-native-svg";
import { CheckSquare, CircleHelp, Copy, FileText, Flag, GitBranch, Layers, Maximize, Merge, Minus, Plus, RotateCcw, ShieldCheck, Trash2, X, Zap, LayoutGrid } from "lucide-react-native";
import { fmsCanvasHandleRadius, routeFmsGraphEdges, FMS_MAX_ZOOM, FMS_MIN_ZOOM, fmsOutgoingStageKeys, hasFmsStageRouting, type FmsFlowDefinition, type FmsFormFieldRef, type FmsStageDefinition } from "@jewelos/core";
import { fmsGraphEdges, fmsStageSummary, fmsTimingSummary, layoutFmsDefinition, type FmsGraphEdge, type FmsGraphPosition } from "@jewelos/data/fms/graph";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Pressable } from "@/ui/Pressable";
import { Text } from "@/ui/Text";
import { createFmsNodeDragSession } from "./fmsCanvasGesture";

/**
 * The FMS workflow canvas — the web `FmsGraphCanvas` for touch.
 *
 * The geometry, the layout, the edges, and every editing action are the web's:
 * move a card, pan the canvas, connect by dragging a card's right dot onto
 * another card, move a connection by dragging its arrow end, remove it, add a
 * next step, duplicate, delete. Pointer and wheel input become one-finger drags
 * and a two-finger pinch. The desktop-only Shift+drag multi-select is omitted.
 */

const NODE_WIDTH = 208;
const NODE_HEIGHT = 104;
const ZOOM_STEP = 1.15;
const WORLD_SIZE = 6000;
const FIT_PADDING = 80;
/** Finger travel that separates a tap from a drag, so selecting a card never nudges it. */
const DRAG_THRESHOLD = 6;
/** A finger-sized target, in screen points, for the connection dots. */
const HANDLE_REACH = 28;

type Tone = "brand" | "success" | "danger" | "warm";
const appearance: Record<FmsStageDefinition["type"], { Icon: typeof CheckSquare; label: string; tone: Tone }> = {
  task: { Icon: CheckSquare, label: "Step", tone: "brand" },
  form: { Icon: FileText, label: "Form", tone: "success" },
  approval: { Icon: ShieldCheck, label: "Approval", tone: "brand" },
  branch: { Icon: GitBranch, label: "Decision", tone: "danger" },
  parallel_start: { Icon: Layers, label: "Split", tone: "warm" },
  parallel_join: { Icon: Merge, label: "Join", tone: "warm" },
  notification: { Icon: Zap, label: "Notify", tone: "brand" },
  end: { Icon: Flag, label: "End", tone: "success" },
};

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const edgeId = (edge: FmsGraphEdge) => `${edge.from}->${edge.to}:${edge.ruleId ?? "default"}`;
const curve = (startX: number, startY: number, endX: number, endY: number) => {
  const bend = Math.max(48, Math.abs(endX - startX) / 2);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
};

type Drag =
  | Readonly<{ kind: "pan"; pointerX: number; pointerY: number; panX: number; panY: number }>
  | { kind: "node"; key: string; origin: FmsGraphPosition; worldX: number; worldY: number; moved: boolean; session: ReturnType<typeof createFmsNodeDragSession> }
  | Readonly<{ kind: "connect"; from: string }>
  | Readonly<{ kind: "reconnect"; from: string; to: string; ruleId?: string | undefined }>;

type Pinch = Readonly<{ distance: number; zoom: number; worldX: number; worldY: number }>;

export type FmsGraphCanvasProps = Readonly<{
  definition: FmsFlowDefinition;
  /** The linked Forms' questions, so a route edge reads as its question and answer labels. */
  formFields: Readonly<Record<string, readonly FmsFormFieldRef[]>>;
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
}>;

export function FmsGraphCanvas(props: FmsGraphCanvasProps) {
  const { definition, formFields, selectedKey, invalidKeys, onSelect, onDelete, onDuplicate, onAddAfter, onDisconnect } = props;
  const theme = useAppTheme();
  const styles = useStyles();
  const viewRef = useRef<View>(null);
  const viewport = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const dragRef = useRef<Drag | null>(null);
  const pinchRef = useRef<Pinch | null>(null);
  const hasCenteredRef = useRef(false);
  const layout = useMemo(() => layoutFmsDefinition(definition), [definition]);
  const edges = useMemo(() => fmsGraphEdges(definition.stages, formFields), [definition.stages, formFields]);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<string | null>(selectedKey);
  const [connecting, setConnecting] = useState<Readonly<{ from: string; x: number; y: number }> | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [activeEdge, setActiveEdge] = useState<string | null>(null);
  /** The gesture help is a toggle, so it never sits on top of the cards. */
  const [hintOpen, setHintOpen] = useState(false);
  // Transient viewport and node movement stays off React's render loop. React
  // receives one durable position update when a gesture ends.
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const scale = useSharedValue(1);
  const dragKey = useSharedValue<string | null>(null);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const viewportLive = useRef({ pan: { x: 0, y: 0 }, zoom: 1 });
  const worldStyle = useAnimatedStyle(() => ({ transform: [{ translateX: panX.value }, { translateY: panY.value }, { scale: scale.value }] }));

  useEffect(() => setSelection(selectedKey), [selectedKey]);

  const saved = useMemo(() => new Map(definition.stages.flatMap((stage) => stage.position ? [[stage.key, stage.position] as const] : [])), [definition.stages]);

  /** A stage keeps its saved coordinates; without them it falls back to the computed layout. */
  const position = (key: string): FmsGraphPosition => {
    const base = saved.get(key) ?? layout.get(key) ?? { x: 60, y: 60 };
    return { x: Math.max(0, base.x), y: Math.max(0, base.y) };
  };

  const routedEdges = useMemo(() => routeFmsGraphEdges(edges.map((edge) => ({ ...edge, id: edgeId(edge) })), new Map(definition.stages.map((stage) => [stage.key, position(stage.key)])), { width: NODE_WIDTH, height: NODE_HEIGHT }), [edges, definition.stages, saved, layout]);
  const routeById = useMemo(() => new Map(routedEdges.map((route) => [route.id, route])), [routedEdges]);
  const edgeDetails = edges.find((edge) => edgeId(edge) === activeEdge);
  const nameOf = (key: string) => definition.stages.find((stage) => stage.key === key)?.name || key;

  const fitView = () => {
    const { width, height } = viewport.current;
    if (!width || !definition.stages.length) return;
    const points = definition.stages.map((stage) => position(stage.key));
    const left = Math.min(...points.map((point) => point.x), ...routedEdges.map((edge) => edge.bounds.left));
    const right = Math.max(...points.map((point) => point.x + NODE_WIDTH), ...routedEdges.map((edge) => edge.bounds.right));
    const top = Math.min(...points.map((point) => point.y), ...routedEdges.map((edge) => edge.bounds.top));
    const bottom = Math.max(...points.map((point) => point.y + NODE_HEIGHT), ...routedEdges.map((edge) => edge.bounds.bottom));
    const next = clamp(Math.min((width - FIT_PADDING) / Math.max(1, right - left), (height - FIT_PADDING) / Math.max(1, bottom - top)), FMS_MIN_ZOOM, 1);
    const nextPan = { x: width / 2 - ((left + right) / 2) * next, y: height / 2 - ((top + bottom) / 2) * next };
    viewportLive.current = { pan: nextPan, zoom: next };
    scale.value = next; panX.value = nextPan.x; panY.value = nextPan.y;
    setZoom(next); setPan(nextPan);
  };

  /** Zooms around the viewport centre so the content in the middle stays put. */
  const zoomBy = (factor: number) => {
    const anchorX = viewport.current.width / 2;
    const anchorY = viewport.current.height / 2;
    const current = viewportLive.current;
    const next = clamp(current.zoom * factor, FMS_MIN_ZOOM, FMS_MAX_ZOOM);
    const nextPan = { x: anchorX - (anchorX - current.pan.x) * (next / current.zoom), y: anchorY - (anchorY - current.pan.y) * (next / current.zoom) };
    viewportLive.current = { pan: nextPan, zoom: next };
    scale.value = next; panX.value = nextPan.x; panY.value = nextPan.y;
    setPan(nextPan); setZoom(next);
  };
  const resetView = () => {
    const nextPan = { x: 0, y: 0 };
    viewportLive.current = { pan: nextPan, zoom: 1 };
    scale.value = 1; panX.value = 0; panY.value = 0;
    setPan(nextPan); setZoom(1);
  };

  // The responder is created once, so it reads everything it needs through here.
  const live = useRef({ pan, zoom, position, edges, activeEdge, definition, props, saved, layout });
  live.current = { pan: viewportLive.current.pan, zoom: viewportLive.current.zoom, position, edges, activeEdge, definition, props, saved, layout };

  const toWorld = (pageX: number, pageY: number) => {
    const { pan: currentPan, zoom: currentZoom } = live.current;
    return { x: (pageX - viewport.current.x - currentPan.x) / currentZoom, y: (pageY - viewport.current.y - currentPan.y) / currentZoom };
  };
  const nodeAt = (world: FmsGraphPosition) => {
    const { definition: current, position: at } = live.current;
    return [...current.stages].reverse().find((stage) => {
      const point = at(stage.key);
      return world.x >= point.x && world.x <= point.x + NODE_WIDTH && world.y >= point.y && world.y <= point.y + NODE_HEIGHT;
    })?.key ?? null;
  };
  const outputAt = (world: FmsGraphPosition) => {
    const { definition: current, position: at, zoom: currentZoom } = live.current;
    return current.stages.find((stage) => {
      if (stage.type === "end") return false;
      const point = at(stage.key);
      return Math.hypot(world.x - (point.x + NODE_WIDTH), world.y - (point.y + NODE_HEIGHT / 2)) <= fmsCanvasHandleRadius(currentZoom, NODE_HEIGHT, HANDLE_REACH);
    })?.key ?? null;
  };

  const startPinch = (touches: readonly NativeTouchEvent[]) => {
    const [first, second] = touches;
    if (!first || !second) return;
    const { pan: currentPan, zoom: currentZoom } = live.current;
    const midX = (first.pageX + second.pageX) / 2 - viewport.current.x;
    const midY = (first.pageY + second.pageY) / 2 - viewport.current.y;
    pinchRef.current = {
      distance: Math.max(1, Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY)),
      zoom: currentZoom,
      worldX: (midX - currentPan.x) / currentZoom,
      worldY: (midY - currentPan.y) / currentZoom,
    };
    dragRef.current = null;
    setConnecting(null);
    setDropTarget(null);
  };

  const responder = useMemo(() => PanResponder.create({
    // Taps stay with the cards and buttons; the canvas only claims a drag or a pinch.
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: (event) => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponderCapture: (event, gesture) => event.nativeEvent.touches.length >= 2 || Math.hypot(gesture.dx, gesture.dy) > DRAG_THRESHOLD,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) { startPinch(touches); return; }
      const world = toWorld(gesture.x0, gesture.y0);
      const current = live.current;
      if (current.activeEdge) {
        const edge = current.edges.find((item) => edgeId(item) === current.activeEdge);
        if (edge) {
          const route = routeFmsGraphEdges(current.edges.map((item) => ({ ...item, id: edgeId(item) })), new Map(current.props.definition.stages.map((stage) => [stage.key, current.position(stage.key)])), { width: NODE_WIDTH, height: NODE_HEIGHT }).find((item) => item.id === edgeId(edge));
          if (route && Math.hypot(world.x - (route.end.x - 10), world.y - route.end.y) <= fmsCanvasHandleRadius(current.zoom, NODE_HEIGHT, HANDLE_REACH)) {
            dragRef.current = { kind: "reconnect", from: edge.from, to: edge.to, ruleId: edge.ruleId };
            setConnecting({ from: edge.from, x: world.x, y: world.y });
            return;
          }
        }
      }
      const from = outputAt(world);
      if (from) {
        dragRef.current = { kind: "connect", from };
        setConnecting({ from, x: world.x, y: world.y });
        return;
      }
      const key = nodeAt(world);
      if (key) {
        setSelection(key);
        const origin = current.position(key);
        dragRef.current = {
          kind: "node", key, origin, worldX: world.x, worldY: world.y, moved: false,
          session: createFmsNodeDragSession({
            key, origin, zoom: current.zoom,
            preview: (_key, next) => { dragKey.value = key; dragX.value = next.x - origin.x; dragY.value = next.y - origin.y; },
            commit: current.props.onMove,
          }),
        };
        return;
      }
      dragRef.current = { kind: "pan", pointerX: gesture.x0, pointerY: gesture.y0, panX: current.pan.x, panY: current.pan.y };
    },
    onPanResponderMove: (event, gesture) => {
      const touches = event.nativeEvent.touches;
      if (touches.length >= 2) {
        const pinch = pinchRef.current;
        if (!pinch) { startPinch(touches); return; }
        const [first, second] = touches;
        if (!first || !second) return;
        const next = clamp(pinch.zoom * (Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY) / pinch.distance), FMS_MIN_ZOOM, FMS_MAX_ZOOM);
        const midX = (first.pageX + second.pageX) / 2 - viewport.current.x;
        const midY = (first.pageY + second.pageY) / 2 - viewport.current.y;
        const nextPan = { x: midX - pinch.worldX * next, y: midY - pinch.worldY * next };
        viewportLive.current = { pan: nextPan, zoom: next };
        scale.value = next; panX.value = nextPan.x; panY.value = nextPan.y;
        return;
      }
      if (pinchRef.current) {
        // One finger lifted: carry on as a pan from where the other one is.
        pinchRef.current = null;
        dragRef.current = { kind: "pan", pointerX: gesture.moveX, pointerY: gesture.moveY, panX: live.current.pan.x, panY: live.current.pan.y };
        return;
      }
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "pan") {
        const nextPan = { x: drag.panX + (gesture.moveX - drag.pointerX), y: drag.panY + (gesture.moveY - drag.pointerY) };
        viewportLive.current = { ...viewportLive.current, pan: nextPan };
        panX.value = nextPan.x; panY.value = nextPan.y;
        return;
      }
      const world = toWorld(gesture.moveX, gesture.moveY);
      if (drag.kind === "connect" || drag.kind === "reconnect") {
        setConnecting((current) => current ? { ...current, x: world.x, y: world.y } : current);
        const hovered = nodeAt(world);
        setDropTarget(hovered && hovered !== drag.from ? hovered : null);
        return;
      }
      const dx = world.x - drag.worldX;
      const dy = world.y - drag.worldY;
      if (!drag.moved && Math.hypot(dx * live.current.zoom, dy * live.current.zoom) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.session.update({ x: dx * live.current.zoom, y: dy * live.current.zoom });
    },
    onPanResponderRelease: (_event, gesture) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (pinchRef.current) { pinchRef.current = null; setPan(viewportLive.current.pan); setZoom(viewportLive.current.zoom); return; }
      const { props: current } = live.current;
      if (drag?.kind === "connect" || drag?.kind === "reconnect") {
        const target = nodeAt(toWorld(gesture.moveX || gesture.x0, gesture.moveY || gesture.y0));
        if (target) {
          if (drag.kind === "connect") current.onConnect(drag.from, target);
          else if (target !== drag.to) current.onReconnect(drag.from, drag.to, target, drag.ruleId);
        }
        setConnecting(null);
        setDropTarget(null);
        setActiveEdge(null);
        return;
      }
      if (drag?.kind === "pan") { setPan(viewportLive.current.pan); setZoom(viewportLive.current.zoom); return; }
      if (drag?.kind !== "node") return;
      if (!drag.moved) { current.onSelect(drag.key); return; }
      drag.session.end();
      dragKey.value = null; dragX.value = 0; dragY.value = 0;
    },
    onPanResponderTerminate: () => {
      dragRef.current = null;
      pinchRef.current = null;
      dragKey.value = null; dragX.value = 0; dragY.value = 0;
      setConnecting(null);
      setDropTarget(null);
    },
  // The handlers read live state through `live`; recreating the responder
  // mid-gesture would drop the gesture.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  const onLayout = () => {
    viewRef.current?.measureInWindow((x, y, width, height) => {
      viewport.current = { x, y, width, height };
      if (!hasCenteredRef.current && definition.stages.length && width) {
        hasCenteredRef.current = true;
        fitView();
      }
    });
  };

  const toneColor = (tone: Tone) => tone === "success" ? theme.colors.success : tone === "danger" ? theme.colors.danger : tone === "warm" ? theme.colors.textWarm : theme.colors.brand;
  const edgeColor = (edge: FmsGraphEdge) => edge.kind === "branch" ? theme.colors.danger : edge.kind === "parallel" ? theme.colors.textWarm : theme.colors.brand;

  const points = definition.stages.map((stage) => position(stage.key));
  const svgLeft = Math.min(0, ...routedEdges.map((edge) => edge.bounds.left - 40));
  const svgTop = Math.min(0, ...routedEdges.map((edge) => edge.bounds.top - 40));
  const svgWidth = Math.max(400, ...points.map((point) => point.x + NODE_WIDTH + 120), ...routedEdges.map((edge) => edge.bounds.right + 80), (connecting?.x ?? 0) + 60);
  const svgHeight = Math.max(400, ...points.map((point) => point.y + NODE_HEIGHT + 120), ...routedEdges.map((edge) => edge.bounds.bottom + 80), (connecting?.y ?? 0) + 60);
  const clearSelection = () => { setSelection(null); setActiveEdge(null); };

  return (
    <View ref={viewRef} onLayout={onLayout} style={styles.viewport} {...responder.panHandlers}>
      <Pressable accessibilityLabel="Workflow canvas" onPress={clearSelection} style={StyleSheet.absoluteFill}>
        <Animated.View style={[styles.world, { width: Math.max(WORLD_SIZE, svgWidth), height: Math.max(WORLD_SIZE, svgHeight) }, worldStyle]}>
          <Svg height={svgHeight - svgTop} style={[styles.svg, { left: svgLeft, top: svgTop }]} width={svgWidth - svgLeft} viewBox={`${svgLeft} ${svgTop} ${svgWidth - svgLeft} ${svgHeight - svgTop}`}>
            {edges.map((edge) => {
              const id = edgeId(edge); const route = routeById.get(id);
              if (!route) return null;
              const endX = route.end.x; const endY = route.end.y;
              const active = activeEdge === id;
              const connected = edge.from === selectedKey || edge.to === selectedKey;
              const midX = route.label.x; const midY = route.label.y;
              const path = route.path; const color = edgeColor(edge); const labelWidth = route.labelWidth;
              const label = `${route.isReturn ? "Return: " : ""}${edge.label ?? (route.isReturn ? nameOf(edge.to) : "")}`;
              return (
                <G key={id}>
                  <Path d={path} fill="none" onPress={() => setActiveEdge(active ? null : id)} stroke="transparent" strokeWidth={24} />
                  <Path d={path} fill="none" stroke={color} {...(edge.kind === "parallel" ? { strokeDasharray: [4, 4] } : {})} strokeOpacity={active || connected ? 1 : selectedKey ? 0.25 : 0.8} strokeWidth={active || connected ? 3 : 2} />
                  <Polygon fill={color} points={`${endX},${endY} ${endX - 7},${endY - 3.5} ${endX - 7},${endY + 3.5}`} />
                  {label ? (
                    <>
                      <Rect fill={theme.colors.surface} height={24} rx={6} stroke={color} strokeOpacity={0.45} width={labelWidth} x={midX - labelWidth / 2} y={midY - 12} />
                      <SvgText fill={color} fontSize={11} textAnchor="middle" x={midX} y={midY + 4}>{label.length > 34 ? `${label.slice(0, 33)}…` : label}</SvgText>
                    </>
                  ) : null}
                  {active ? <Rect fill={theme.colors.surface} height={14} rx={7} stroke={color} strokeWidth={2} width={14} x={endX - 17} y={endY - 7} /> : null}
                </G>
              );
            })}
            {connecting ? (
              <Path d={curve(position(connecting.from).x + NODE_WIDTH, position(connecting.from).y + NODE_HEIGHT / 2, connecting.x, connecting.y)} fill="none" stroke={theme.colors.brand} strokeDasharray={[5, 5]} strokeWidth={2} />
            ) : null}
          </Svg>

          {edges.filter((edge) => edgeId(edge) === activeEdge).map((edge) => {
            const route = routeById.get(edgeId(edge)); if (!route) return null;
            const midX = route.label.x; const midY = route.label.y + 28;
            return (
              <Pressable
                accessibilityLabel={`Remove the connection to ${edge.to}`}
                accessibilityRole="button"
                key={`remove-${edgeId(edge)}`}
                onPress={() => { onDisconnect(edge.from, edge.to, edge.ruleId); setActiveEdge(null); }}
                style={[styles.edgeRemove, { left: midX - 14, top: midY - 14, borderColor: edgeColor(edge) }]}
              >
                <X color={edgeColor(edge)} size={14} />
              </Pressable>
            );
          })}

          {definition.stages.map((stage, index) => {
            const point = position(stage.key);
            const item = appearance[stage.type];
            const tone = toneColor(item.tone);
            const active = selection === stage.key || stage.key === selectedKey || edgeDetails?.from === stage.key || edgeDetails?.to === stage.key;
            const invalid = invalidKeys.has(stage.key);
            const canOutput = stage.type !== "end";
            const canAppend = !["end", "branch", "parallel_start"].includes(stage.type);
            const isLeaf = fmsOutgoingStageKeys(stage).length === 0 && stage.type !== "end";
            const routed = hasFmsStageRouting(stage) || stage.type === "branch";
            const borderColor = dropTarget === stage.key ? theme.colors.success : invalid ? theme.colors.danger : active ? theme.colors.brand : theme.colors.borderStrong;
            return (
              <AnimatedNodeFrame dragKey={dragKey} dragX={dragX} dragY={dragY} nodeKey={stage.key} point={point} style={styles.nodeFrame}>
                {index === 0 ? <View style={[styles.flag, styles.flagTop]}><Text tone="primary" variant="caption" weight="semibold">Starts here</Text></View> : null}
                {isLeaf ? <View style={[styles.flag, styles.flagBottom]}><Text tone="success" variant="caption" weight="semibold">Completes here</Text></View> : null}
                <Pressable
                  accessibilityLabel={stage.name || "Untitled stage"}
                  accessibilityRole="button"
                  onPress={() => { setSelection(stage.key); setActiveEdge(null); onSelect(stage.key); }}
                  style={[styles.node, { borderColor, borderWidth: active || invalid || dropTarget === stage.key ? 2 : 1 }]}
                >
                  <View style={styles.nodeTop}>
                    <View style={[styles.typeBadge, { borderColor: tone }]}>
                      <item.Icon color={tone} size={11} />
                      <Text style={{ color: tone }} variant="caption" weight="semibold">
                        {(stage.sla.decisionMode === "yes_no" || stage.sla.decisionMode === "decision" ? "Decision" : item.label).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.nodeActions}>
                      <Pressable accessibilityLabel={`Duplicate ${stage.name}`} hitSlop={6} onPress={() => onDuplicate(stage.key)} style={styles.nodeAction}><Copy color={theme.colors.textMuted} size={14} /></Pressable>
                      <Pressable accessibilityLabel={`Delete ${stage.name}`} hitSlop={6} onPress={() => onDelete(stage.key)} style={styles.nodeAction}><Trash2 color={theme.colors.textMuted} size={14} /></Pressable>
                    </View>
                  </View>
                  <Text numberOfLines={1} variant="small" weight="semibold">{stage.name || "Untitled stage"}</Text>
                  <Text numberOfLines={1} tone="muted" variant="caption">{`${fmsStageSummary(stage)} · ${fmsTimingSummary(stage)}`}</Text>
                  {invalid ? <Text numberOfLines={1} tone="danger" variant="caption" weight="medium">Needs attention</Text> : null}
                </Pressable>
                <View pointerEvents="none" style={[styles.inputDot, { backgroundColor: theme.colors.brand }]} />
                {canOutput ? <View pointerEvents="none" style={[styles.outputDot, { backgroundColor: routed ? theme.colors.danger : theme.colors.brand }]} /> : null}
                {canAppend ? (
                  <Pressable accessibilityLabel={`Add next step after ${stage.name}`} accessibilityRole="button" onPress={() => onAddAfter(stage.key)} style={styles.append}>
                    <Plus color={theme.colors.brand} size={16} />
                  </Pressable>
                ) : null}
              </AnimatedNodeFrame>
            );
          })}
        </Animated.View>
      </Pressable>

      <View style={styles.controls}>
        <Pressable accessibilityLabel="Zoom out" onPress={() => zoomBy(1 / ZOOM_STEP)} style={styles.control}><Minus color={theme.colors.brand} size={16} /></Pressable>
        <Text style={styles.zoomLabel} tone="warm" variant="caption">{`${Math.round(zoom * 100)}%`}</Text>
        <Pressable accessibilityLabel="Zoom in" onPress={() => zoomBy(ZOOM_STEP)} style={styles.control}><Plus color={theme.colors.brand} size={16} /></Pressable>
        <Pressable accessibilityLabel="Fit workflow to view" onPress={fitView} style={styles.control}><Maximize color={theme.colors.brand} size={16} /></Pressable>
        <Pressable accessibilityLabel="Auto-arrange workflow" onPress={() => props.onMove(Object.fromEntries(layout))} style={styles.control}><LayoutGrid color={theme.colors.brand} size={16} /></Pressable>
        <Pressable accessibilityLabel="Reset workflow view" onPress={resetView} style={styles.control}><RotateCcw color={theme.colors.brand} size={16} /></Pressable>
        <Pressable accessibilityLabel="How to use the map" accessibilityState={{ expanded: hintOpen }} onPress={() => setHintOpen((open) => !open)} style={[styles.control, hintOpen && { backgroundColor: theme.colors.brandSoft }]}><CircleHelp color={theme.colors.brand} size={16} /></Pressable>
      </View>
      {edgeDetails ? <View style={[styles.hint, styles.hintBottom]}><Text weight="semibold" variant="small">{`${nameOf(edgeDetails.from)} to ${nameOf(edgeDetails.to)}`}</Text><Text variant="caption">{edgeDetails.label || "Continue to next step"}</Text><Pressable accessibilityLabel="Remove selected connection" onPress={() => { onDisconnect(edgeDetails.from, edgeDetails.to, edgeDetails.ruleId); setActiveEdge(null); }}><Text tone="danger" variant="small">Remove connection</Text></Pressable></View> : null}
      {(connecting || hintOpen) && !edgeDetails ? <View pointerEvents="none" style={[styles.hint, connecting ? styles.hintBottom : styles.hintTop]}>
        <Text tone="muted" variant="caption">
          {connecting ? "Drop on a step to connect · release on empty space to cancel" : "Tap a card to edit it · drag a card to move it · drag empty space to pan · pinch to zoom · drag a card’s right dot onto another card to connect · tap a connection to remove it or drag its arrow end to move it"}
        </Text>
      </View> : null}
    </View>
  );
}

function AnimatedNodeFrame({ children, dragKey, dragX, dragY, nodeKey, point, style }: Readonly<{
  children: ReactNode;
  dragKey: SharedValue<string | null>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  nodeKey: string;
  point: FmsGraphPosition;
  style: object;
}>) {
  const previewStyle = useAnimatedStyle(() => ({
    transform: dragKey.value === nodeKey ? [{ translateX: dragX.value }, { translateY: dragY.value }] : [{ translateX: 0 }, { translateY: 0 }],
  }));
  return <Animated.View style={[style, { left: point.x, top: point.y }, previewStyle]}>{children}</Animated.View>;
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  viewport: {
    // Fills whatever bounded region the screen gives it, so a short phone does
    // not get a canvas taller than the screen.
    flex: 1,
    overflow: "hidden",
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  world: { position: "absolute", left: 0, top: 0, width: WORLD_SIZE, height: WORLD_SIZE, transformOrigin: "top left" },
  svg: { position: "absolute", left: 0, top: 0 },
  nodeFrame: { position: "absolute", width: NODE_WIDTH, height: NODE_HEIGHT },
  node: {
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    padding: 10,
    gap: 2,
  },
  nodeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  nodeActions: { flexDirection: "row", gap: 2 },
  nodeAction: { padding: 4, borderRadius: theme.radius.sm },
  flag: { position: "absolute", left: 0, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, borderRadius: theme.radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  flagTop: { top: -26 },
  flagBottom: { bottom: -26 },
  inputDot: { position: "absolute", left: -6, top: NODE_HEIGHT / 2 - 6, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.surface, opacity: 0.7 },
  outputDot: { position: "absolute", right: -9, top: NODE_HEIGHT / 2 - 9, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.colors.surface },
  append: {
    position: "absolute",
    right: -58,
    top: NODE_HEIGHT / 2 - 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
  },
  edgeRemove: { position: "absolute", width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface },
  controls: { position: "absolute", right: 8, top: 8, flexDirection: "row", alignItems: "center", gap: 2, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, padding: 2 },
  control: { minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.sm },
  hintTop: { top: 60 },
  // Above the builder's floating Add Step button.
  hintBottom: { bottom: 64 },
  zoomLabel: { minWidth: 40, textAlign: "center" },
  hint: { position: "absolute", left: 8, right: 8, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, paddingHorizontal: 8, paddingVertical: 4, opacity: 0.95 },
}));

export type { GestureResponderEvent };
