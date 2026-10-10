import { describe, expect, it } from "vitest";
import {
  KIARA_CHUNK_MAX_CHARS,
  chunkKnowledgeText,
  countWords,
  docxHtmlToKnowledgeText,
  isLittleText,
  knowledgeTitleFromFilename,
  normalizeKnowledgeText,
} from "./chunking.ts";

// Synthetic fixtures only: no real SOP text belongs in Git.
const chunksOf = (text: string, options?: Parameters<typeof chunkKnowledgeText>[1]) => {
  const result = chunkKnowledgeText(text, options);
  if (!result.ok) throw new Error(result.error);
  return result.chunks;
};

describe("docxHtmlToKnowledgeText", () => {
  it("keeps Word heading levels, paragraphs, lists, and tables as rows", () => {
    const html = "<h1>Leave policy</h1><p>Apply early.</p><h2>1. Applying</h2><ul><li>Open Availability</li><li>Press &quot;Apply&quot;</li></ul>"
      + "<table><tr><td><p>Type</p></td><td><p>Days</p></td></tr><tr><td><p>Casual</p></td><td><p>12</p></td></tr></table><h3>Notes</h3><p>A &amp; B</p>";
    const result = docxHtmlToKnowledgeText(html);
    expect(result.headingMode).toBe("styles");
    expect(result.text).toBe("# Leave policy\n\nApply early.\n\n## 1. Applying\n\n- Open Availability\n- Press \"Apply\"\n\nType | Days\nCasual | 12\n\n### Notes\n\nA & B");
  });

  it("ignores images but counts them", () => {
    const result = docxHtmlToKnowledgeText("<p>Before</p><p><img src=\"\" /></p><p>After</p>");
    expect(result.text).toBe("Before\n\nAfter");
    expect(result.imageCount).toBe(1);
  });

  it("uses bold-only paragraphs as headings when there are no heading styles", () => {
    const html = "<p><strong>Opening the store</strong></p><p>Unlock at 10.</p><p><strong>Closing</strong></p><p>Lock the safe. <strong>Always.</strong></p>";
    const result = docxHtmlToKnowledgeText(html);
    expect(result.headingMode).toBe("bold");
    expect(result.text).toBe("# Opening the store\n\nUnlock at 10.\n\n# Closing\n\nLock the safe. Always.");
  });

  it("infers title lines after rules, in capitals, or numbered, and drops the rules", () => {
    const html = "<p>DAILY ROUTINE</p><p>Intro text here.</p><p>---</p><p>Greeting the guest</p><p>Smile and greet.</p><p>2) Billing</p><p>Check the bill.</p>";
    const result = docxHtmlToKnowledgeText(html);
    expect(result.headingMode).toBe("inferred");
    expect(result.text).toBe("# DAILY ROUTINE\n\nIntro text here.\n\n# Greeting the guest\n\nSmile and greet.\n\n# 2) Billing\n\nCheck the bill.");
  });

  it("falls back to no headings for plain prose", () => {
    const result = docxHtmlToKnowledgeText("<p>One plain paragraph.</p><p>Another plain paragraph.</p>");
    expect(result.headingMode).toBe("none");
    expect(result.text).toBe("One plain paragraph.\n\nAnother plain paragraph.");
  });

  it("never lets a body paragraph pose as a heading line", () => {
    const result = docxHtmlToKnowledgeText("<h1>Title</h1><p># not a heading</p>");
    expect(result.text).toBe("# Title\n\nnot a heading");
  });

  it("keeps Devanagari text intact", () => {
    const result = docxHtmlToKnowledgeText("<h1>छुट्टी</h1><p>पहले से आवेदन करें।</p>");
    expect(result.text).toBe("# छुट्टी\n\nपहले से आवेदन करें।");
    expect(result.wordCount).toBe(5);
  });
});

describe("chunkKnowledgeText", () => {
  it("makes one chunk per heading section with the heading path", () => {
    const chunks = chunksOf("# Leave\n\nIntro.\n\n## Applying\n\nStep one.\n\nStep two.\n\n### Late\n\nTell HR.\n\n# Uniform\n\nWear it.", { packChars: 0 });
    expect(chunks).toEqual([
      { heading_path: "Leave", content: "Intro." },
      { heading_path: "Leave > Applying", content: "Step one.\n\nStep two." },
      { heading_path: "Leave > Applying > Late", content: "Tell HR." },
      { heading_path: "Uniform", content: "Wear it." },
    ]);
  });

  it("packs small sections under one top-level heading, keeping sub-headings in the text", () => {
    const chunks = chunksOf("# Leave\n\nIntro.\n\n## Applying\n\nStep one.\n\n### Late\n\nTell HR.\n\n# Uniform\n\n## Colour\n\nBlack.\n\n## Shoes\n\nPolished.");
    expect(chunks).toEqual([
      { heading_path: "Leave", content: "Intro.\n\n## Applying\n\nStep one.\n\n### Late\n\nTell HR." },
      { heading_path: "Uniform", content: "## Colour\n\nBlack.\n\n## Shoes\n\nPolished." },
    ]);
  });

  it("does not pack past the pack size", () => {
    const body = "word ".repeat(150).trim();
    const chunks = chunksOf(`# A\n\n## One\n\n${body}\n\n## Two\n\n${body}`, { packChars: 1000 });
    expect(chunks.map((chunk) => chunk.heading_path)).toEqual(["A > One", "A > Two"]);
  });

  it("keeps text before the first heading under an empty path", () => {
    expect(chunksOf("Preface.\n\n# A\n\nBody.")).toEqual([{ heading_path: "", content: "Preface." }, { heading_path: "A", content: "Body." }]);
  });

  it("takes body lines typed straight under a heading", () => {
    expect(chunksOf("# A\nBody right below.")).toEqual([{ heading_path: "A", content: "Body right below." }]);
  });

  it("splits long sections at paragraphs with a short overlap and the same path", () => {
    const paragraph = (n: number) => `Paragraph ${n} ${"word ".repeat(30).trim()}.`;
    const text = `# Long\n\n${Array.from({ length: 12 }, (_, i) => paragraph(i + 1)).join("\n\n")}`;
    const chunks = chunksOf(text, { targetChars: 600 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.heading_path === "Long" && chunk.content.length <= 600)).toBe(true);
    // Each later chunk starts with the previous chunk's last paragraph.
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]!.content.split("\n\n");
      expect(chunks[index]!.content.startsWith(previous[previous.length - 1]!)).toBe(true);
    }
  });

  it("cuts one over-long paragraph at sentence ends", () => {
    const sentence = "The display must be checked every hour by the floor manager. ";
    const text = `# Rules\n\n${sentence.repeat(200).trim()}`;
    const chunks = chunksOf(text, { targetChars: 1000 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((chunk) => chunk.content.length <= 1000 && chunk.content.endsWith("."))).toBe(true);
  });

  it("cuts text without headings by size (fixed-size fallback)", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Line ${i} ${"x".repeat(80)}`).join("\n\n");
    const chunks = chunksOf(text, { targetChars: 1000 });
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((chunk) => chunk.heading_path === "")).toBe(true);
  });

  it("produces only verbatim slices of the text, within the database limit", () => {
    const html = "<h1>T</h1>" + Array.from({ length: 60 }, (_, i) => `<p>Para ${i} ${"lorem ipsum ".repeat(40)}</p>`).join("")
      + "<table>" + Array.from({ length: 50 }, (_, i) => `<tr><td>r${i}</td><td>${"cell ".repeat(30)}</td></tr>`).join("") + "</table>";
    const { text } = docxHtmlToKnowledgeText(html);
    const chunks = chunksOf(text);
    expect(chunks.every((chunk) => text.includes(chunk.content) && chunk.content.length <= KIARA_CHUNK_MAX_CHARS && chunk.content.trim() === chunk.content)).toBe(true);
  });

  it("refuses empty and over-long text", () => {
    expect(chunkKnowledgeText("  \n ").ok).toBe(false);
    expect(chunkKnowledgeText("a".repeat(500_001)).ok).toBe(false);
  });

  it("keeps a headings-only text as one chunk", () => {
    expect(chunksOf("# Only a title")).toEqual([{ heading_path: "", content: "# Only a title" }]);
  });
});

describe("helpers", () => {
  it("normalizes line endings and blank runs only", () => {
    expect(normalizeKnowledgeText("a  \r\n\r\n\r\n\r\nb\t\n")).toBe("a\n\nb");
  });

  it("counts words without heading marks and flags little text", () => {
    expect(countWords("# Title\n\nOne two three")).toBe(4);
    expect(isLittleText(149)).toBe(true);
    expect(isLittleText(150)).toBe(false);
  });

  it("derives readable titles from file names", () => {
    expect(knowledgeTitleFromFilename("Synthetic Policy_30th July 2026.docx")).toBe("Synthetic Policy");
    expect(knowledgeTitleFromFilename("📦 SOP – Synthetic Handover (2)_1st May 2026.docx")).toBe("SOP – Synthetic Handover");
    expect(knowledgeTitleFromFilename("Synthetic_Checklist_Guide (1).DOCX")).toBe("Synthetic Checklist Guide");
    expect(knowledgeTitleFromFilename(".docx")).toBe("Untitled document");
  });
});
