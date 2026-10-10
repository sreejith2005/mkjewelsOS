import { describe, expect, it } from "vitest";
import { routeFmsGraphEdges } from "./graphRouting";

const positions = new Map([["a", { x: 60, y: 100 }], ["b", { x: 420, y: 100 }], ["c", { x: 780, y: 100 }]]);
const size = { width: 208, height: 104 };
describe("shared FMS connection geometry", () => {
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
