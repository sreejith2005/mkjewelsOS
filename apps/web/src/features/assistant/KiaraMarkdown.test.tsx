// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KiaraMarkdown, inAppPath, parseKiaraBlocks, sanitizeKiaraText } from "./KiaraMarkdown";

afterEach(cleanup);

describe("Kiara answer rendering", () => {
  it("renders paragraphs, bullet and numbered lists, and bold", () => {
    const { container } = render(<KiaraMarkdown onNavigate={vi.fn()} text={"Aapke **2 task** pending hain:\n- Count stock\n- Fill stock form\n\nSteps:\n1. Open Tasks\n2. Tap the task"} />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("2 task");
  });

  it("never renders images, HTML, or external links", () => {
    const { container } = render(<KiaraMarkdown onNavigate={vi.fn()} text={'See ![x](https://evil.example/p.png) <img src="https://evil.example/q.png"> <script>alert(1)</script> [click](https://evil.example/steal?d=1)'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).not.toContain("evil.example");
    expect(container.textContent).toContain("click");
  });

  it("turns only known in-app paths into navigation", () => {
    const onNavigate = vi.fn();
    render(<KiaraMarkdown onNavigate={onNavigate} text={"Open [Availability](/availability) or [this](/not-a-section) or [that](//evil.example)"} />);
    fireEvent.click(screen.getByRole("button", { name: "Availability" }));
    expect(onNavigate).toHaveBeenCalledWith("/availability");
    expect(screen.queryByRole("button", { name: "this" })).toBeNull();
    expect(screen.queryByRole("button", { name: "that" })).toBeNull();
    expect(inAppPath("/tasks?tab=delegated")).toBe("/tasks?tab=delegated");
    expect(inAppPath("https://evil.example")).toBeNull();
  });

  it("hides citation markers and heading marks", () => {
    expect(sanitizeKiaraText("## Leave\nApply early [[cite:abc]] and [[ci")).toBe("Leave\nApply early  and ");
    expect(parseKiaraBlocks("one\n\ntwo")).toEqual([{ kind: "paragraph", text: "one" }, { kind: "paragraph", text: "two" }]);
  });
});
