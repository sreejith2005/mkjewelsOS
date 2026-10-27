// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FormWorkspace } from "./FormWorkspace";

describe("Forms workspace", () => {
  it("preserves both panes when toggling and resizing", () => {
    const editor = <input aria-label="Edit name" defaultValue="Original" />;
    const live = <input aria-label="Test answer" />;
    const { rerender } = render(<FormWorkspace editor={editor} live={live} preview={false} />);
    fireEvent.change(screen.getByLabelText("Test answer"), { target: { value: "Keep me" } });
    fireEvent.change(screen.getByLabelText("Edit name"), { target: { value: "Edited" } });
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("63");
    rerender(<FormWorkspace editor={editor} live={live} preview />);
    expect((screen.getByLabelText("Test answer") as HTMLInputElement).value).toBe("Keep me");
    expect((screen.getByLabelText("Edit name") as HTMLInputElement).value).toBe("Edited");
  });
});
