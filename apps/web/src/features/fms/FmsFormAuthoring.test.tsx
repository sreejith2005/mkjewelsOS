// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { FmsFormActions, FmsFormAuthoring } from "./FmsFormAuthoring";

const mocks = vi.hoisted(() => ({ load: vi.fn(), saved: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@jewelos/data/fms/formAuthoring", () => ({ loadFmsFormAuthoring: mocks.load }));
vi.mock("@/features/forms/FormBuilder", () => ({ FormBuilder: ({ bundle, onClose, onSaved }: { bundle?: { id: string }; onClose: () => void; onSaved: () => Promise<void> }) => <div>Editing {bundle?.id}<button onClick={() => void onSaved()}>Save form</button><button onClick={onClose}>Return</button></div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("opens the existing Forms workspace with the pinned bundle and returns to its parent", async () => {
  const target = { flowId: "draft", stageKey: "call", action: "edit" as const, formTemplateId: "pinned-version" };
  mocks.load.mockResolvedValue({ bundle: { id: "pinned-version" }, dynamicOptions: {} });
  const close = vi.fn();
  render(<FmsFormAuthoring target={target} onClose={close} onSaved={mocks.saved} />);
  expect(await screen.findByText("Editing pinned-version")).toBeTruthy();
  expect(mocks.load).toHaveBeenCalledWith(target);
  await userEvent.click(screen.getByRole("button", { name: "Save form" }));
  expect(mocks.saved).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Return" }));
  expect(close).toHaveBeenCalledOnce();
});

it("allows linked preview without offering Forms authoring to a workflow-only editor", async () => {
  const open = vi.fn();
  render(<FmsFormActions linked canManage={false} disabled={false} onOpen={open} />);
  expect(screen.queryByRole("button", { name: "Open Form Builder" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Create New Form" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Preview Form" }));
  expect(open).toHaveBeenCalledWith("preview");
});
