import { describe, expect, it } from "vitest";
import { routeFmsGraphEdges } from "./graphRouting";

const positions = new Map([["a", { x: 60, y: 100 }], ["b", { x: 420, y: 100 }], ["c", { x: 780, y: 100 }]]);
const size = { width: 208, height: 104 };
describe("shared FMS connection geometry", () => {
  it("keeps slightly staggered neighboring cards connected by a short smooth link", () => {
    const [edge] = routeFmsGraphEdges([{ id: "near", from: "a", to: "b", label: "Next" }], new Map([["a", { x: 60, y: 100 }], ["b", { x: 420, y: 135 }]]), size);
    expect(edge!.path).toContain(" C ");
    expect(Math.max(...edge!.points.map((p) => p.y))).toBeLessThanOrEqual(edge!.end.y);
  });
  it("does not send neighboring routes below the workflow to make room for labels", () => {
    const routes = routeFmsGraphEdges([{ id: "one", from: "a", to: "b", label: "A long answer label for this route" }, { id: "two", from: "a", to: "b", label: "Another long answer label" }], positions, size);
    expect(routes.every((edge) => edge.path.includes(" C "))).toBe(true);
    expect(routes.every((edge) => Math.max(...edge.points.map((p) => p.y)) < 204)).toBe(true);
    expect(Math.abs(routes[0]!.label.y - routes[1]!.label.y)).toBeGreaterThanOrEqual(24);
  });
  it("keeps obstacle detours local despite unrelated distant cards", () => {
    const withDistant = new Map([...positions, ["distant", { x: 2500, y: 3000 }] as const]);
    const [edge] = routeFmsGraphEdges([{ id: "skip", from: "a", to: "c", label: "Skip" }], withDistant, size);
    expect(edge!.bounds.bottom).toBeLessThan(500);
  });
  it("keeps compact labels beside their link without overlapping neighboring cards", () => {
    const [edge] = routeFmsGraphEdges([{ id: "near", from: "a", to: "b", label: "Interested proceed to next step" }], new Map([["a", { x: 60, y: 100 }], ["b", { x: 360, y: 100 }]]), size);
    expect(edge!.label.x - edge!.labelWidth / 2).toBeGreaterThan(edge!.start.x);
    expect(edge!.label.x + edge!.labelWidth / 2).toBeLessThan(edge!.end.x);
    expect(Math.abs(edge!.label.y - edge!.start.y)).toBeLessThan(30);
  });
  it("routes returns around intervening cards and labels them outside cards", () => {
    const [edge] = routeFmsGraphEdges([{ id: "return", from: "c", to: "a", label: "Try again" }], positions, size);
    expect(edge!.isReturn).toBe(true);
    expect(edge!.points.some((point) => point.y > 204)).toBe(true);
    expect(edge!.label.y).toBeGreaterThan(204);
    expect(edge!.end.x).toBe(60);
    expect(edge!.points.at(-2)!.x).toBeLessThan(edge!.end.x);
    expect(edge!.path).not.toContain("NaN");
  });
  it("separates multiple routes sharing endpoints", () => {
    const edges = routeFmsGraphEdges([{ id: "one", from: "c", to: "a", label: "One" }, { id: "two", from: "c", to: "a", label: "Two" }], positions, size);
    expect(edges[0]!.path).not.toBe(edges[1]!.path);
    expect(edges[0]!.label.y).not.toBe(edges[1]!.label.y);
    expect(edges[0]!.start.y).not.toBe(edges[1]!.start.y);
  });
  it("routes a self-return outside its own card", () => {
    const [edge] = routeFmsGraphEdges([{ id: "self", from: "b", to: "b" }], positions, size);
    expect(edge!.isReturn).toBe(true);
    expect(edge!.start.x).toBe(628);
    expect(edge!.end.x).toBe(420);
    expect(edge!.bounds.bottom).toBeGreaterThan(204);
  });
  it("avoids a card placed in a forward connection's path", () => {
    const [edge] = routeFmsGraphEdges([{ id: "skip", from: "a", to: "c" }], positions, size);
    for (let index = 1; index < edge!.points.length; index++) {
      const a = edge!.points[index - 1]!; const b = edge!.points[index]!;
      if (a.y === b.y && a.y > 100 && a.y < 204) expect(Math.min(a.x, b.x) < 628 && Math.max(a.x, b.x) > 420).toBe(false);
    }
  });
  it("ignores missing nodes and produces finite geometry for tight layouts", () => {
    expect(routeFmsGraphEdges([{ id: "missing", from: "a", to: "missing" }], positions, size)).toEqual([]);
    const [edge] = routeFmsGraphEdges([{ id: "tight", from: "a", to: "b" }], new Map([["a", { x: 0, y: 0 }], ["b", { x: 230, y: 0 }]]), size);
    expect(edge!.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });
});
