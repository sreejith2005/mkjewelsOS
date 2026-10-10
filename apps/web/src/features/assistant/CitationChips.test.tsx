// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CitationChips } from "./CitationChips";

vi.mock("@jewelos/data/assistant/api", () => ({ getKiaraKnowledgeExcerpt: vi.fn() }));

afterEach(cleanup);

const citations = [
  { marker: 2, chunk_id: "k2", document_id: "d1", title: "Synthetic SOP", heading_path: "" },
  { marker: 1, chunk_id: "k1", document_id: "d1", title: "Synthetic SOP", heading_path: "Opening > Keys" },
];

describe("CitationChips", () => {
  it("lists sources in marker order with their sections", () => {
    render(<CitationChips citations={citations} load={vi.fn()} />);
    const chips = screen.getAllByRole("button").map((button) => button.textContent);
    expect(chips).toEqual(["[1]Synthetic SOP · Opening > Keys", "[2]Synthetic SOP"]);
  });

  it("opens the cited excerpt as plain text", async () => {
    const load = vi.fn().mockResolvedValue({ available: true, title: "Synthetic SOP", heading_path: "Opening > Keys", content: "Keys stay in the <b>safe</b>." });
    render(<CitationChips citations={citations} load={load} />);
    fireEvent.click(screen.getByText("Synthetic SOP · Opening > Keys"));
    expect(load).toHaveBeenCalledWith("k1");
    expect(await screen.findByText("Keys stay in the <b>safe</b>.")).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
  });

  it("says when the section is gone", async () => {
    render(<CitationChips citations={citations} load={vi.fn().mockResolvedValue({ available: false })} />);
    fireEvent.click(screen.getByText("Synthetic SOP"));
    expect(await screen.findByText(/no longer available/)).toBeTruthy();
  });

  it("renders nothing without citations", () => {
    const { container } = render(<CitationChips citations={[]} load={vi.fn()} />);
    expect(container.textContent).toBe("");
  });
});
