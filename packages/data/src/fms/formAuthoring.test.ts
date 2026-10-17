import { expect, it, vi } from "vitest";
import type { FmsFlowDefinition } from "@jewelos/core";
import { prepareFmsFormAuthoring } from "./formAuthoring";
const definition = { stages: [{ key: "call", formTemplateId: "pinned-form" }] } as unknown as FmsFlowDefinition;
it("saves the current workflow before returning an exact form-editor destination", async () => {
  let saved: ((id: string) => void) | undefined;
  const persist = vi.fn(() => new Promise<string>(resolve => { saved = resolve; }));
  const pending = prepareFmsFormAuthoring(definition, "call", "edit", true, persist);
  expect(persist).toHaveBeenCalledOnce();
  saved?.("saved-draft");
  expect(await pending).toEqual({ flowId: "saved-draft", stageKey: "call", action: "edit", formTemplateId: "pinned-form" });
});
it("keeps Forms authoring permission separate and never saves for a denied editor action", async () => {
  const persist = vi.fn();
  await expect(prepareFmsFormAuthoring(definition, "call", "create", false, persist)).rejects.toThrow("Forms authoring");
  expect(persist).not.toHaveBeenCalled();
});
it("retains the pinned version for preview and rejects a missing stage", async () => {
  const persist = vi.fn().mockResolvedValue("draft");
  expect(await prepareFmsFormAuthoring(definition, "call", "preview", false, persist)).toMatchObject({ formTemplateId: "pinned-form", stageKey: "call" });
  persist.mockClear();
  await expect(prepareFmsFormAuthoring(definition, "foreign", "edit", true, persist)).rejects.toThrow("step");
  expect(persist).not.toHaveBeenCalled();
});
