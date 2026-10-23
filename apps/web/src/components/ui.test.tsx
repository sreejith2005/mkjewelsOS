import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./ui";

describe("Modal", () => {
  it("lets a filling form title scroll without changing other dialogs", () => {
    const fill = renderToStaticMarkup(<Modal stickyHeader={false} onClose={vi.fn()} title="Fill form">Questions</Modal>);
    const normal = renderToStaticMarkup(<Modal onClose={vi.fn()} title="Action">Content</Modal>);
    expect(fill).not.toContain("sticky");
    // Pinned through the sheet's p-5 padding, so scrolled content cannot show above the title.
    expect(normal).toContain("sticky -top-5");
    expect(renderToStaticMarkup(<Modal mobileFullscreen onClose={vi.fn()} title="Full screen">Content</Modal>)).toContain("sticky top-0");
    expect(fill).toContain('aria-modal="true"');
  });
  it("reserves the bottom safe area when rendered as a mobile sheet", () => {
    const html = renderToStaticMarkup(<Modal onClose={vi.fn()} title="Mobile action">Content</Modal>);

    expect(html).toContain("pb-[max(1.25rem,env(safe-area-inset-bottom))]");
  });
});
