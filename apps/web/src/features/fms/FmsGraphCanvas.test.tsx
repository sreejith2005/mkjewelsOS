// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
