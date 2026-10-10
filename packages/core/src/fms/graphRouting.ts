import type { FmsBounds, FmsPoint, FmsSize } from "./canvas";

export type FmsCanvasEdge = Readonly<{ id: string; from: string; to: string; label?: string | undefined }>;
export type FmsRoutedEdge = Omit<FmsCanvasEdge, "label"> & Readonly<{ path: string; points: readonly FmsPoint[]; start: FmsPoint; end: FmsPoint; label: FmsPoint; labelWidth: number; isReturn: boolean; bounds: FmsBounds }>;
type Box = FmsBounds;
const distance = (a: FmsPoint, b: FmsPoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const clear = (a: FmsPoint, b: FmsPoint, boxes: readonly Box[]) => !boxes.some((box) => a.x === b.x
  ? a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom
  : a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right);

/** A visibility grid uses obstacle boundaries, so it is independent of pixel resolution. */
function around(start: FmsPoint, end: FmsPoint, boxes: readonly Box[]): FmsPoint[] {
  if (start.x === end.x || start.y === end.y) if (clear(start, end, boxes)) return [start, end];
  for (const corner of [{ x: end.x, y: start.y }, { x: start.x, y: end.y }]) if (clear(start, corner, boxes) && clear(corner, end, boxes)) return [start, corner, end];
  const xs = [...new Set([start.x, end.x, ...boxes.flatMap((box) => [box.left, box.right])])].sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...boxes.flatMap((box) => [box.top, box.bottom])])].sort((a, b) => a - b);
  const width = xs.length;
  const key = (point: FmsPoint) => ys.indexOf(point.y) * width + xs.indexOf(point.x);
  const point = (id: number): FmsPoint => ({ x: xs[id % width]!, y: ys[Math.floor(id / width)]! });
  const first = key(start); const last = key(end);
  const costs = new Map<number, number>([[first, 0]]); const parents = new Map<number, number>();
  const heap: Array<{ id: number; score: number }> = [];
  const push = (item: { id: number; score: number }) => {
    heap.push(item); let i = heap.length - 1;
    while (i > 0) { const p = Math.floor((i - 1) / 2); if (heap[p]!.score <= item.score) break; heap[i] = heap[p]!; i = p; } heap[i] = item;
  };
  const pop = () => {
    const firstItem = heap[0]!; const tail = heap.pop()!;
    if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let c = i * 2 + 1; if (c + 1 < heap.length && heap[c + 1]!.score < heap[c]!.score) c++; if (heap[c]!.score >= tail.score) break; heap[i] = heap[c]!; i = c; } heap[i] = tail; }
    return firstItem;
  };
  push({ id: first, score: distance(start, end) }); const visited = new Set<number>();
  while (heap.length) {
    const { id } = pop(); if (visited.has(id)) continue; visited.add(id);
    if (id === last) { const route = [end]; let cursor = last; while (cursor !== first) { cursor = parents.get(cursor)!; route.push(point(cursor)); } return route.reverse(); }
    const x = id % width; const y = Math.floor(id / width); const a = point(id);
    const neighbors = [x > 0 ? id - 1 : -1, x + 1 < width ? id + 1 : -1, y > 0 ? id - width : -1, y + 1 < ys.length ? id + width : -1];
    for (const next of neighbors) {
      if (next < 0 || visited.has(next)) continue; const b = point(next);
      if (!clear(a, b, boxes)) continue;
      const cost = costs.get(id)! + distance(a, b);
      if (cost >= (costs.get(next) ?? Infinity)) continue;
      costs.set(next, cost); parents.set(next, id); push({ id: next, score: cost + distance(b, end) });
    }
  }
  // Overlapping saved cards can cover a port. Still provide editable finite geometry.
  return [start, { x: start.x, y: Math.max(...boxes.map((box) => box.bottom)) + 40 }, { x: end.x, y: Math.max(...boxes.map((box) => box.bottom)) + 40 }, end];
}

function roundedPath(points: readonly FmsPoint[]): string {
  let path = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1]!; const b = points[i]!; const c = points[i + 1]!;
    const radius = Math.min(8, distance(a, b) / 2, distance(b, c) / 2);
    const before = { x: b.x + Math.sign(a.x - b.x) * radius, y: b.y + Math.sign(a.y - b.y) * radius };
    const after = { x: b.x + Math.sign(c.x - b.x) * radius, y: b.y + Math.sign(c.y - b.y) * radius };
    path += ` L ${before.x} ${before.y} Q ${b.x} ${b.y} ${after.x} ${after.y}`;
  }
  return `${path} L ${points.at(-1)!.x} ${points.at(-1)!.y}`;
}

/** Short forward curves; only obstacles and returns need exterior lanes. */
export function routeFmsGraphEdges(edges: readonly FmsCanvasEdge[], positions: ReadonlyMap<string, FmsPoint>, node: FmsSize): readonly FmsRoutedEdge[] {
  const usable = edges.filter((edge) => positions.has(edge.from) && positions.has(edge.to));
  const nodeKeys = [...positions.keys()];
  const boxes = [...positions.values()].map((p) => ({ left: p.x - 14, top: p.y - 14, right: p.x + node.width + 14, bottom: p.y + node.height + 14 }));
  const cards = [...positions.values()].map((p) => ({ left: p.x, top: p.y, right: p.x + node.width, bottom: p.y + node.height }));
  const lanes: Box[] = [];
  const labels: Box[] = [];
  return usable.map((edge) => {
    const from = positions.get(edge.from)!; const to = positions.get(edge.to)!;
    const outgoing = usable.filter((item) => item.from === edge.from); const incoming = usable.filter((item) => item.to === edge.to);
    const start = { x: from.x + node.width, y: from.y + node.height * (outgoing.indexOf(edge) + 1) / (outgoing.length + 1) };
    const end = { x: to.x, y: to.y + node.height * (incoming.indexOf(edge) + 1) / (incoming.length + 1) };
    const a = { x: start.x + 20 + Math.min(24, outgoing.indexOf(edge) * 6), y: start.y }; const b = { x: end.x - 20 - Math.min(24, incoming.indexOf(edge) * 6), y: end.y };
    const isReturn = end.x <= start.x;
    let labelWidth = Math.min(200, Math.max(isReturn ? 80 : 50, (edge.label?.length ?? 0) * 6.4 + (isReturn ? 38 : 20)));
    const directLabel = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 16 };
    const labelBox = (p: FmsPoint): Box => ({ left: p.x - labelWidth / 2 - 4, right: p.x + labelWidth / 2 + 4, top: p.y - 15, bottom: p.y + 15 });
    const overlaps = (box: Box, other: Box) => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
    const between = boxes.filter((_, index) => nodeKeys[index] !== edge.from && nodeKeys[index] !== edge.to);
    const corridor = { left: start.x, right: end.x, top: Math.min(start.y, end.y) - 1, bottom: Math.max(start.y, end.y) + 1 };
    const direct = !isReturn && !between.some((box) => overlaps(corridor, box));
    let label = directLabel; let middle: FmsPoint[]; let path: string | undefined;
    if (direct) {
      labelWidth = Math.min(labelWidth, Math.max(50, end.x - start.x - 16));
      const bend = Math.min(120, (end.x - start.x) / 2);
      const c1 = { x: start.x + bend, y: start.y }; const c2 = { x: end.x - bend, y: end.y };
      middle = [c1, c2];
      path = `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`;
      // Labels move independently. A crowded label must never turn a short link into a detour.
      if (edge.label) {
        const obstacles = [...cards, ...labels];
        for (let offset = 0; offset <= usable.length + 4; offset++) {
          const candidate = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 16 - offset * 26 };
          label = candidate;
          if (!obstacles.some((box) => overlaps(labelBox(candidate), box))) break;
        }
      }
    }
    else {
      const local = boxes.filter((box) => box.right >= Math.min(from.x, to.x) - 40 && box.left <= Math.max(from.x, to.x) + node.width + 40 && box.top <= Math.max(from.y, to.y) + node.height + 48 && box.bottom >= Math.min(from.y, to.y) - 48);
      let y = Math.max(from.y + node.height, to.y + node.height, ...local.map((box) => box.bottom)) + 36;
      const left = Math.min(a.x, b.x) - (a.x === b.x ? 40 : 0); const right = Math.max(a.x, b.x);
      while (lanes.some((lane) => lane.left < right && lane.right > left && Math.abs(lane.top - y) < 32)) y += 32;
      lanes.push({ left, right, top: y, bottom: y });
      label = { x: (left + right) / 2, y };
      // Reserve enough horizontal run for the label even for a tiny same-column route.
      const l = Math.min(left, label.x - labelWidth / 2 - 16); const r = Math.max(right, label.x + labelWidth / 2 + 16);
      const first = { x: isReturn ? r : l, y }; const last = { x: isReturn ? l : r, y };
      middle = [...around(a, first, boxes), last, ...around(last, b, boxes).slice(1)];
    }
    if (edge.label) labels.push(labelBox(label));
    const points = [start, ...middle, end].filter((p, i, all) => i === 0 || distance(p, all[i - 1]!) > 0);
    const bounds = { left: Math.min(...points.map((p) => p.x), label.x - labelWidth / 2), right: Math.max(...points.map((p) => p.x), label.x + labelWidth / 2), top: Math.min(...points.map((p) => p.y), label.y - 16), bottom: Math.max(...points.map((p) => p.y), label.y + 16) };
    return { ...edge, start, end, isReturn, points, path: path ?? roundedPath(points), label, labelWidth, bounds };
  });
}
