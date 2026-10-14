import { describe, expect, it } from "vitest";
import { kiaraInAppPath, parseKiaraBlocks, sanitizeKiaraText, splitKiaraInline } from "./markdown.ts";

describe("Kiara answer formatting (shared by web and Android)", () => {
  it("parses paragraphs, bullet and numbered lists", () => {
    expect(parseKiaraBlocks("Aapke **2 task** pending hain:\n- Count stock\n- Fill stock form\n\nSteps:\n1. Open Tasks\n2. Tap the task")).toEqual([
      { kind: "paragraph", text: "Aapke **2 task** pending hain:" },
      { kind: "list", ordered: false, items: ["Count stock", "Fill stock form"] },
      { kind: "paragraph", text: "Steps:" },
      { kind: "list", ordered: true, items: ["Open Tasks", "Tap the task"] },
    ]);
  });

  it("keeps Devanagari text intact", () => {
    expect(parseKiaraBlocks("नमस्ते!\n- छुट्टी के लिए आवेदन करें")).toEqual([
      { kind: "paragraph", text: "नमस्ते!" },
      { kind: "list", ordered: false, items: ["छुट्टी के लिए आवेदन करें"] },
    ]);
  });

  it("removes images, HTML, code fences and heading marks", () => {
    const clean = sanitizeKiaraText('# Title\n![x](https://evil.example/p.png) <img src="q"> ```js\ncode');
    expect(clean).not.toContain("evil.example");
    expect(clean).not.toContain("<img");
    expect(clean).not.toContain("```");
    expect(clean.startsWith("Title")).toBe(true);
  });

  it("splits bold and links, and links only in-app paths", () => {
    expect(splitKiaraInline("Open **Tasks** or [Availability](/availability) or [x](https://evil.example) or [y](//evil.example)")).toEqual([
      { kind: "text", text: "Open " },
      { kind: "bold", text: "Tasks" },
      { kind: "text", text: " or " },
      { kind: "link", label: "Availability", path: "/availability" },
      { kind: "text", text: " or " },
      { kind: "link", label: "x", path: null },
      { kind: "text", text: " or " },
      { kind: "link", label: "y", path: null },
    ]);
    expect(kiaraInAppPath("/tasks?tab=delegated")).toBe("/tasks?tab=delegated");
    expect(kiaraInAppPath("/crm/followups")).toBe("/crm/followups");
    expect(kiaraInAppPath("/crm/clients/not-an-id")).toBeNull();
  });
});
