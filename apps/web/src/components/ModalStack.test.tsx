// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Modal } from "./ui";

afterEach(cleanup);

it("closes only the dialog on top when Escape is pressed", () => {
  const outer = vi.fn();
  const inner = vi.fn();
  render(<Modal onClose={outer} title="Leave management"><Modal onClose={inner} title="Delete leave requests">Confirm</Modal></Modal>);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(inner).toHaveBeenCalledTimes(1);
  expect(outer).not.toHaveBeenCalled();
});
