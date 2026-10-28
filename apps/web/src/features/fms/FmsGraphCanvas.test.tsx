// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FmsFlowDefinition } from "@jewelos/core";
import { FmsGraphCanvas } from "./FmsGraphCanvas";
import { newFmsStage } from "./definition";

afterEach(cleanup);
const definition = { name: "Loop", scope: "tenant" as const, manualTrigger: true as const, stages: [
  { ...newFmsStage("form", 0), key: "start", name: "Start", defaultNextStageKey: "follow", position: { x: 40, y: 100 } },
  { ...newFmsStage("task", 1), key: "follow", name: "Follow up", defaultNextStageKey: "start", position: { x: 500, y: 100 } },
] };
const props = () => ({ definition, formFields: {}, selectedKeys: [] as readonly string[], inspectedKey: "follow", invalidKeys: new Set<string>(), onSelectionChange: vi.fn(), onOpen: vi.fn(), onCommand: vi.fn(), onDelete: vi.fn(), onDuplicate: vi.fn(), onAddAfter: vi.fn(), onConnect: vi.fn(), onDisconnect: vi.fn(), onReconnect: vi.fn(), onMove: vi.fn(), onEditRoute: vi.fn() });

beforeEach(() => { try { window.localStorage.setItem("jewelos.fms.canvasTip.v1", "1"); } catch { /* ignore */ } });

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
    const route = screen.getByLabelText("Return: Follow up → Start");
    fireEvent.keyDown(route, { key: "Enter" });
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
  it("labels ordinary steps by name only, never 'Normal step'", () => {
    const { container } = render(<FmsGraphCanvas {...props()} />);
    expect(container.querySelector('[data-node-key="follow"]')!.textContent).not.toMatch(/Normal|Decision/);
    expect(container.querySelector('[data-node-key="start"]')!.textContent).toContain("Form");
  });
  it("shows the gesture tip once until it is dismissed", () => {
    window.localStorage.removeItem("jewelos.fms.canvasTip.v1");
    render(<FmsGraphCanvas {...props()} />);
    expect(screen.getByRole("note").textContent).toContain("Drag empty space to select");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    render(<FmsGraphCanvas {...props()} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

/** Reads the world layer's camera from its CSS transform. */
const camera = (container: HTMLElement) => {
  const match = /translate\((-?[\d.e-]+)px, (-?[\d.e-]+)px\) scale\(([\d.e-]+)\)/.exec(container.querySelector<HTMLElement>(".origin-top-left")!.style.transform)!;
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
};
const nextFrame = () => act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
const drag = (target: Element, from: { x: number; y: number }, to: { x: number; y: number }, init: Record<string, unknown> = {}) => {
  fireEvent.pointerDown(target, { pointerId: 1, button: 0, clientX: from.x, clientY: from.y, pointerType: "mouse", ...init });
  fireEvent.pointerMove(target, { pointerId: 1, clientX: to.x, clientY: to.y, pointerType: "mouse" });
  fireEvent.pointerUp(target, { pointerId: 1, button: init.button ?? 0, clientX: to.x, clientY: to.y, pointerType: "mouse" });
};

/** jsdom implements neither pointer capture, hit testing nor PointerEvent (coordinates and ids would be dropped). */
function pointerSupport() {
  Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
  if (!("PointerEvent" in window)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number; pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 0; this.pointerType = init.pointerType ?? "mouse"; }
    }
    vi.stubGlobal("PointerEvent", PointerEventPolyfill);
  }
}

describe("FMS canvas navigation and selection", () => {
  beforeEach(pointerSupport);
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("zooms in on wheel up and out on wheel down without any modifier, and stops the page scrolling", async () => {
    const { container } = render(<FmsGraphCanvas {...props()} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    expect(fireEvent.wheel(viewport, { deltaY: -100, clientX: 0, clientY: 0 })).toBe(false);
    await nextFrame();
    const zoomedIn = camera(container).zoom;
    expect(zoomedIn).toBeGreaterThan(1.1);
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
    // A capped notch moves about 15%, so 8 notches pass 2x and 30 pass 0.1x.
    for (let i = 0; i < 8; i++) { fireEvent.wheel(viewport, { deltaY: -500 }); await nextFrame(); }
    expect(camera(container).zoom).toBe(2);
    for (let i = 0; i < 30; i++) { fireEvent.wheel(viewport, { deltaY: 500 }); await nextFrame(); }
    expect(camera(container).zoom).toBe(0.1);
  }, 20_000);

  it("draws a selection rectangle when empty space is dragged in Select mode, selecting every step it touches, without panning", () => {
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    expect(screen.getByRole("button", { name: "Select mode" }).getAttribute("aria-pressed")).toBe("true");
    const before = camera(container);
    // From above-left of Start to the left edge of Follow up: touching both cards counts.
    drag(viewport, { x: 10, y: 60 }, { x: 520, y: 150 });
    expect(camera(container)).toEqual(before);
    expect(input.onSelectionChange).toHaveBeenLastCalledWith(["start", "follow"]);
    drag(viewport, { x: 10, y: 60 }, { x: 100, y: 150 });
    expect(input.onSelectionChange).toHaveBeenLastCalledWith(["start"]);
  });

  it("clears the selection on a plain click of empty space", () => {
    const input = props();
    render(<FmsGraphCanvas {...input} selectedKeys={["start"]} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 300, clientY: 400, pointerType: "mouse" });
    fireEvent.pointerUp(viewport, { pointerId: 1, button: 0, clientX: 300, clientY: 400, pointerType: "mouse" });
    expect(input.onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("pans when empty space is dragged in Hand mode, with Space held, or with the middle button", () => {
    const { container } = render(<FmsGraphCanvas {...props()} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    fireEvent.click(screen.getByRole("button", { name: "Hand mode" }));
    let before = camera(container);
    drag(viewport, { x: 300, y: 300 }, { x: 360, y: 250 });
    expect(camera(container)).toEqual({ x: before.x + 60, y: before.y - 50, zoom: before.zoom });

    fireEvent.click(screen.getByRole("button", { name: "Select mode" }));
    before = camera(container);
    fireEvent.keyDown(viewport, { key: " " });
    drag(viewport, { x: 300, y: 300 }, { x: 320, y: 330 });
    fireEvent.keyUp(viewport, { key: " " });
    expect(camera(container)).toEqual({ x: before.x + 20, y: before.y + 30, zoom: before.zoom });

    before = camera(container);
    drag(viewport, { x: 300, y: 300 }, { x: 290, y: 300 }, { button: 1 });
    expect(camera(container)).toEqual({ x: before.x - 10, y: before.y, zoom: before.zoom });
  });

  it("opens a step on a plain click and toggles it with Shift or Ctrl", () => {
    const input = props();
    const { container, rerender } = render(<FmsGraphCanvas {...input} />);
    const card = container.querySelector<HTMLElement>('[data-node-key="start"]')!;
    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 100, clientY: 140, pointerType: "mouse" });
    fireEvent.pointerUp(card, { pointerId: 1, button: 0, clientX: 100, clientY: 140, pointerType: "mouse" });
    expect(input.onOpen).toHaveBeenCalledWith("start");
    rerender(<FmsGraphCanvas {...input} selectedKeys={["start"]} />);
    const follow = container.querySelector<HTMLElement>('[data-node-key="follow"]')!;
    fireEvent.pointerDown(follow, { pointerId: 1, button: 0, clientX: 520, clientY: 140, pointerType: "mouse", shiftKey: true });
    fireEvent.pointerUp(follow, { pointerId: 1, button: 0, clientX: 520, clientY: 140, pointerType: "mouse" });
    expect(input.onSelectionChange).toHaveBeenLastCalledWith(["start", "follow"]);
    expect(input.onOpen).toHaveBeenCalledTimes(1);
    rerender(<FmsGraphCanvas {...input} selectedKeys={["start", "follow"]} />);
    fireEvent.pointerDown(follow, { pointerId: 1, button: 0, clientX: 520, clientY: 140, pointerType: "mouse", ctrlKey: true });
    fireEvent.pointerUp(follow, { pointerId: 1, button: 0, clientX: 520, clientY: 140, pointerType: "mouse" });
    expect(input.onSelectionChange).toHaveBeenLastCalledWith(["start"]);
  });

  it("moves a dragged card without panning the canvas", () => {
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} />);
    const before = camera(container);
    const card = container.querySelector<HTMLElement>('[data-node-key="start"]')!;
    drag(card, { x: 100, y: 140 }, { x: 180, y: 200 });
    expect(camera(container)).toEqual(before);
    expect(input.onMove).toHaveBeenCalledWith({ start: { x: 120, y: 160 } });
  });

  it("lets a card go past the left edge: the layout and camera shift together, so nothing jumps", () => {
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} />);
    const before = camera(container);
    const card = container.querySelector<HTMLElement>('[data-node-key="start"]')!;
    drag(card, { x: 100, y: 140 }, { x: 0, y: 100 });
    // Start would land at x -60; every card moves right by 60 so saved positions stay >= 0.
    expect(input.onMove).toHaveBeenCalledOnce();
    expect(input.onMove).toHaveBeenCalledWith({ start: { x: 0, y: 60 }, follow: { x: 560, y: 100 } });
    expect(camera(container)).toEqual({ ...before, x: before.x - 60 });
  });

  it("moves every selected step together, keeping their spacing, in one change", () => {
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} selectedKeys={["start", "follow"]} />);
    const card = container.querySelector<HTMLElement>('[data-node-key="follow"]')!;
    drag(card, { x: 520, y: 140 }, { x: 560, y: 110 });
    expect(input.onMove).toHaveBeenCalledOnce();
    expect(input.onMove).toHaveBeenCalledWith({ start: { x: 80, y: 70 }, follow: { x: 540, y: 70 } });
    expect(input.onOpen).not.toHaveBeenCalled();
  });

  it("still connects steps by dragging a card's output onto another card", () => {
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} />);
    const target = container.querySelector<HTMLElement>('[data-node-key="follow"]')!;
    document.elementFromPoint = vi.fn(() => target);
    const before = camera(container);
    const handle = container.querySelector<HTMLElement>('[data-node-output="start"]')!;
    drag(handle, { x: 250, y: 150 }, { x: 520, y: 150 });
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
    fireEvent.keyDown(viewport, { key: "1" });
    const fitted = camera(container);
    expect(fitted.zoom).toBeLessThanOrEqual(1);
    expect(fitted.x).not.toBe(0);
  });

  it("sends editor shortcuts to the builder from the canvas, but never from a text field", () => {
    const input = props();
    render(<><input aria-label="Elsewhere" /><FmsGraphCanvas {...input} selectedKeys={["follow"]} /></>);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    fireEvent.keyDown(viewport, { key: "c", ctrlKey: true });
    fireEvent.keyDown(viewport, { key: "x", metaKey: true });
    fireEvent.keyDown(viewport, { key: "d", ctrlKey: true });
    fireEvent.keyDown(viewport, { key: "a", ctrlKey: true });
    fireEvent.keyDown(viewport, { key: "z", ctrlKey: true });
    fireEvent.keyDown(viewport, { key: "z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(viewport, { key: "Delete" });
    expect(input.onCommand.mock.calls.map((call) => call[0])).toEqual(["copy", "cut", "duplicate", "selectAll", "undo", "redo", "delete"]);
    fireEvent.keyDown(viewport, { key: "Escape" });
    expect(input.onSelectionChange).toHaveBeenLastCalledWith([]);

    input.onCommand.mockClear();
    const field = screen.getByLabelText("Elsewhere");
    for (const key of ["c", "v", "a", "d", "z"]) fireEvent.keyDown(field, { key, ctrlKey: true });
    fireEvent.keyDown(field, { key: "Backspace" });
    expect(input.onCommand).not.toHaveBeenCalled();
  });

  it("pastes clipboard text through the browser's paste event", () => {
    const input = props();
    render(<FmsGraphCanvas {...input} />);
    const viewport = screen.getByRole("application", { name: "Workflow canvas" });
    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: { getData: () => string } };
    event.clipboardData = { getData: () => "{\"format\":\"mkjewels.fms.fragment\"}" };
    viewport.dispatchEvent(event);
    expect(input.onCommand).toHaveBeenCalledWith("paste", expect.objectContaining({ text: "{\"format\":\"mkjewels.fms.fragment\"}" }));
  });

  it("selects exactly one route with a thin hit line and offers a compact action bar", () => {
    const input = props();
    const branching: FmsFlowDefinition = { ...definition, stages: [
      { ...definition.stages[0]!, defaultNextStageKey: "follow", branchRules: [
        { id: "r-yes", source: "context", sourceKey: "answer", operator: "equals", value: "yes", nextStageKey: "follow", order: 0, label: "Yes" },
        { id: "r-no", source: "context", sourceKey: "answer", operator: "equals", value: "no", nextStageKey: "follow", order: 1, label: "No" },
      ] },
      { ...definition.stages[1]!, defaultNextStageKey: undefined },
    ] };
    const { container } = render(<FmsGraphCanvas {...input} definition={branching} />);
    const hits = [...container.querySelectorAll<SVGPathElement>("path[data-edge-hit]")];
    expect(hits).toHaveLength(3);
    for (const hit of hits) expect(Number(hit.getAttribute("stroke-width"))).toBeLessThanOrEqual(10);
    const no = hits.find((hit) => hit.getAttribute("aria-label")!.endsWith(": No"))!;
    fireEvent.pointerDown(no, { pointerId: 1, button: 0, clientX: 300, clientY: 150, pointerType: "mouse" });
    fireEvent.pointerUp(no, { pointerId: 1, button: 0, clientX: 300, clientY: 150, pointerType: "mouse" });
    expect(hits.filter((hit) => hit.getAttribute("aria-pressed") === "true")).toEqual([no]);
    const bar = screen.getByRole("toolbar", { name: "Connection actions" });
    fireEvent.click(within(bar).getByRole("button", { name: "Edit route" }));
    expect(input.onEditRoute).toHaveBeenCalledWith("start", "r-no");
    fireEvent.keyDown(no, { key: "Enter" });
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Connection actions" })).getByRole("button", { name: "Delete route" }));
    expect(input.onDisconnect).toHaveBeenCalledWith("start", "follow", "r-no");
  });

  it("changes a route's destination by clicking the new step", () => {
    const input = props();
    const three = { ...definition, stages: [...definition.stages, { ...newFmsStage("task", 2), key: "close", name: "Close", position: { x: 900, y: 100 } }] };
    const { container } = render(<FmsGraphCanvas {...input} definition={three} />);
    fireEvent.keyDown(screen.getByLabelText("Start → Follow up"), { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Change destination" }));
    expect(screen.getByText("Click the step this route should go to")).toBeTruthy();
    const close = container.querySelector<HTMLElement>('[data-node-key="close"]')!;
    fireEvent.pointerDown(close, { pointerId: 1, button: 0, clientX: 950, clientY: 140, pointerType: "mouse" });
    fireEvent.pointerUp(close, { pointerId: 1, button: 0, clientX: 950, clientY: 140, pointerType: "mouse" });
    expect(input.onReconnect).toHaveBeenCalledWith("start", "follow", "close", undefined);
    expect(input.onOpen).not.toHaveBeenCalled();
  });

  it("shows a bulk action bar for several selected steps", () => {
    const input = props();
    render(<FmsGraphCanvas {...input} selectedKeys={["start", "follow"]} />);
    const bar = screen.getByRole("toolbar", { name: "2 selected" });
    for (const name of ["Copy selected steps", "Duplicate selected steps", "Cut selected steps", "Delete selected steps"]) expect(within(bar).getByRole("button", { name })).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "Duplicate selected steps" }));
    expect(input.onCommand).toHaveBeenCalledWith("duplicate", expect.anything());
    fireEvent.click(within(bar).getByRole("button", { name: "Clear selection" }));
    expect(input.onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("offers the same actions on right-click", () => {
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} />);
    fireEvent.contextMenu(container.querySelector('[data-node-key="follow"]')!, { clientX: 520, clientY: 140 });
    expect(input.onSelectionChange).toHaveBeenLastCalledWith(["follow"]);
    const menu = screen.getByRole("menu", { name: "Canvas actions" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Copy/ }));
    expect(input.onCommand).toHaveBeenCalledWith("copy", expect.anything());
    fireEvent.contextMenu(screen.getByRole("application", { name: "Workflow canvas" }), { clientX: 300, clientY: 500 });
    fireEvent.click(within(screen.getByRole("menu", { name: "Canvas actions" })).getByRole("menuitem", { name: /Paste here/ }));
    expect(input.onCommand).toHaveBeenLastCalledWith("paste", { anchor: { x: 300, y: 500 } });
  });

  it("renders a 100-step workflow with many routes quickly", () => {
    const stages = Array.from({ length: 100 }, (_, index) => ({ ...newFmsStage("task", index), key: `s${index}`, name: `Step ${index}`, defaultNextStageKey: index < 99 ? `s${index + 1}` : undefined, position: { x: (index % 10) * 300, y: Math.floor(index / 10) * 180 },
      branchRules: index % 3 === 0 && index < 97 ? [{ id: `r${index}`, source: "context" as const, sourceKey: "x", operator: "equals" as const, value: "y", nextStageKey: `s${index + 3}`, order: 0 }] : [] }));
    const started = performance.now();
    const { container } = render(<FmsGraphCanvas {...props()} definition={{ ...definition, stages }} />);
    const elapsed = performance.now() - started;
    expect(container.querySelectorAll("[data-node-key]")).toHaveLength(100);
    expect(container.querySelectorAll("path[data-edge-hit]").length).toBeGreaterThan(120);
    expect(elapsed).toBeLessThan(5000);
  }, 20_000);

  it("fills its workspace edge to edge when asked, and keeps the bounded card otherwise", () => {
    const { rerender } = render(<FmsGraphCanvas {...props()} fill />);
    expect(screen.getByRole("application", { name: "Workflow canvas" }).className).toContain("h-full");
    rerender(<FmsGraphCanvas {...props()} />);
    expect(screen.getByRole("application", { name: "Workflow canvas" }).className).toContain("rounded-2xl");
  });
});

describe("FMS canvas on a phone", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    pointerSupport();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("starts in Hand mode so one finger moves around, and a long press adds a step to the selection", () => {
    vi.useFakeTimers();
    const input = props();
    const { container } = render(<FmsGraphCanvas {...input} selectedKeys={["start"]} />);
    expect(screen.getByRole("button", { name: "Hand mode" }).getAttribute("aria-pressed")).toBe("true");
    const follow = container.querySelector<HTMLElement>('[data-node-key="follow"]')!;
    fireEvent.pointerDown(follow, { pointerId: 2, button: 0, clientX: 520, clientY: 140, pointerType: "touch" });
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.pointerUp(follow, { pointerId: 2, button: 0, clientX: 520, clientY: 140, pointerType: "touch" });
    expect(input.onSelectionChange).toHaveBeenLastCalledWith(["start", "follow"]);
    expect(input.onOpen).not.toHaveBeenCalled();
  });
});
