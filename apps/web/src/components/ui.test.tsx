import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./ui";

describe("Modal", () => {
  it("reserves the bottom safe area when rendered as a mobile sheet", () => {
    const html = renderToStaticMarkup(<Modal onClose={vi.fn()} title="Mobile action">Content</Modal>);

    expect(html).toContain("pb-[max(1.25rem,env(safe-area-inset-bottom))]");
  });
});
