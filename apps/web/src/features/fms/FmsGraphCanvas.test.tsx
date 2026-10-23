// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FmsGraphCanvas } from "./FmsGraphCanvas";
import { newFmsStage } from "./definition";

afterEach(cleanup);
const definition = { name: "Loop", scope: "tenant" as const, manualTrigger: true as const, stages: [
  { ...newFmsStage("form", 0), key: "start", name: "Start", defaultNextStageKey: "follow", position: { x: 40, y: 100 } },
  { ...newFmsStage("task", 1), key: "follow", name: "Follow up", defaultNextStageKey: "start", position: { x: 500, y: 100 } },
] };
const props = () => ({ definition, formFields: {}, selectedKey: "follow", invalidKeys: new Set<string>(), onSelect: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onAddAfter: vi.fn(), onConnect: vi.fn(), onDisconnect: vi.fn(), onReconnect: vi.fn(), onMove: vi.fn() });
describe("FMS canvas", () => {
  it("keeps saved positions until explicit auto-arrange", () => {
    const input = props(); render(<FmsGraphCanvas {...input} />);
    expect(input.onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Auto-arrange workflow" }));
    expect(input.onMove).toHaveBeenCalledOnce();
    expect(input.onMove.mock.calls[0]![0].follow.x).not.toBe(500);
  });
  it("exposes direction and full connection details without relying on color", () => {
    render(<FmsGraphCanvas {...props()} />);
    expect(screen.getByLabelText("Return: Follow up → Start")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Return: Follow up → Start"));
    expect(screen.getByText("Follow up → Start")).toBeTruthy();
  });
  it("keeps cards and return routes visible beyond the former world boundary", () => {
    const input = props();
    const large = { ...definition, stages: definition.stages.map((stage, index) => ({ ...stage, position: { x: 6200 + index * 400, y: 5900 } })) };
    const { container } = render(<FmsGraphCanvas {...input} definition={large} />);
    expect(container.querySelector<HTMLElement>('[data-node-key="start"]')!.style.left).toBe("6200px");
    expect(Number(container.querySelector('path[role="button"]')!.closest("svg")!.getAttribute("height"))).toBeGreaterThan(6000);
    expect(Number(container.querySelector('path[role="button"]')!.closest("svg")!.getAttribute("width"))).toBeGreaterThan(6800);
    expect(container.querySelector('path[role="button"]')!.getAttribute("d")).toContain("6408");
  });

});

/** Reads the world layer's camera from its CSS transform. */
const camera = (container: HTMLElement) => {
  const match = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(container.querySelector<HTMLElement>(".origin-top-left")!.style.transform)!;
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
};
const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

describe("FMS canvas navigation", () => {
  beforeEach(() => {
    // jsdom implements neither pointer capture nor hit testing.
    Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
    // jsdom has no PointerEvent, so coordinates and pointer ids would be dropped.
    if (!("PointerEvent" in window)) {
      class PointerEventPolyfill extends MouseEvent {
        pointerId: number; pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? "mouse"; }
      }
      vi.stubGlobal("PointerEvent", PointerEventPolyfill);
    }
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("zooms in on wheel up and out on wheel down without any modifier, and stops the page scrolling", async () => {
    const { container } = render(<FmsGraphCanvas {...props()} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    expect(fireEvent.wheel(viewport, { deltaY: -100, clientX: 0, clientY: 0 })).toBe(false);
    await nextFrame();
    const zoomedIn = camera(container).zoom;
    expect(zoomedIn).toBeGreaterThan(1.1);
    expect(screen.getByText(`${Math.round(zoomedIn * 100)}%`)).toBeTruthy();
    fireEvent.wheel(viewport, { deltaY: 100 });
    fireEvent.wheel(viewport, { deltaY: 100 });
    await nextFrame();
    expect(camera(container).zoom).toBeLessThan(1);
  });

  it("keeps the world point under the pointer fixed and folds a burst of wheel events into one update", async () => {
    const { container } = render(<FmsGraphCanvas {...props()} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    const pointer = { clientX: 540, clientY: 160 };
    const before = camera(container);
    const worldBefore = { x: (pointer.clientX - before.x) / before.zoom, y: (pointer.clientY - before.y) / before.zoom };
    for (let i = 0; i < 5; i++) fireEvent.wheel(viewport, { deltaY: -20, ...pointer });
    expect(camera(container)).toEqual(before);
    await nextFrame();
    const after = camera(container);
    expect(after.zoom).toBeGreaterThan(before.zoom);
    expect((pointer.clientX - after.x) / after.zoom).toBeCloseTo(worldBefore.x, 6);
    expect((pointer.clientY - after.y) / after.zoom).toBeCloseTo(worldBefore.y, 6);
  });

  it("respects the shared zoom limits", async () => {
    const { container } = render(<FmsGraphCanvas {...props()} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    for (let i = 0; i < 60; i++) { fireEvent.wheel(viewport, { deltaY: -500 }); await nextFrame(); }
    expect(camera(container).zoom).toBe(2);
    for (let i = 0; i < 80; i++) { fireEvent.wheel(viewport, { deltaY: 500 }); await nextFrame(); }
    expect(camera(container).zoom).toBe(0.1);
  });

  it("pans when empty canvas space is dragged", () => {
    const { container } = render(<FmsGraphCanvas {...props()} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    const before = camera(container);
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 300, clientY: 300, pointerType: "mouse" });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 360, clientY: 250, pointerType: "mouse" });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 360, clientY: 250, pointerType: "mouse" });
    expect(camera(container)).toEqual({ x: before.x + 60, y: before.y - 50, zoom: before.zoom });
  });

  it("moves a dragged card without panning the canvas", () => {
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} />);
    const before = camera(container);
    const card = container.querySelector<HTMLElement>('[data-node-key="start"]')!;
    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 100, clientY: 140, pointerType: "mouse" });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 180, clientY: 200, pointerType: "mouse" });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 180, clientY: 200, pointerType: "mouse" });
    expect(camera(container)).toEqual(before);
    expect(input.onMove).toHaveBeenCalledWith({ start: { x: 120, y: 160 } });
  });

  it("still connects steps by dragging a card's output onto another card", () => {
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} />);
    const target = container.querySelector<HTMLElement>('[data-node-key="follow"]')!;
    document.elementFromPoint = vi.fn(() => target);
    const before = camera(container);
    const handle = container.querySelector<HTMLElement>('[data-node-output="start"]')!;
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 250, clientY: 150, pointerType: "mouse" });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 520, clientY: 150, pointerType: "mouse" });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 520, clientY: 150, pointerType: "mouse" });
    expect(input.onConnect).toHaveBeenCalledWith("start", "follow");
    expect(camera(container)).toEqual(before);
  });

  it("keeps the zoom buttons, keyboard shortcuts and Fit to View", () => {
    const { container } = render(<FmsGraphCanvas {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(camera(container).zoom).toBeCloseTo(1.15, 6);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(camera(container).zoom).toBeCloseTo(1, 6);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    fireEvent.keyDown(viewport, { key: "+" });
    expect(camera(container).zoom).toBeCloseTo(1.15, 6);
    fireEvent.keyDown(viewport, { key: "0" });
    expect(camera(container).zoom).toBeCloseTo(1, 6);
    Object.defineProperty(viewport, "clientWidth", { configurable: true, value: 1200 });
    Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 700 });
    fireEvent.click(screen.getByRole("button", { name: "Fit workflow to view" }));
    const fitted = camera(container);
    expect(fitted.zoom).toBeLessThanOrEqual(1);
    expect(fitted.x).not.toBe(0);
  });

  it("fills its workspace edge to edge when asked, and keeps the bounded card on phones", () => {
    const { rerender } = render(<FmsGraphCanvas {...props()} fill />);
    expect(screen.getByRole("application", { name: "Workflow canvas" }).className).toContain("h-full");
    expect(screen.getByRole("application", { name: "Workflow canvas" }).className).not.toContain("rounded-2xl");
    rerender(<FmsGraphCanvas {...props()} />);
    expect(screen.getByRole("application", { name: "Workflow canvas" }).className).toContain("rounded-2xl");
  });
});
