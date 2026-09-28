import { describe, expect, it, vi } from "vitest";
import { workUploadFormDefinition, type Json } from "@jewelos/core";

const saved = vi.hoisted(() => ({
  saveDraft: vi.fn(async (_id: string | null, _payload: Json, _fields: Json) => "saved-template-id"),
  publishForm: vi.fn(async (_id: string) => undefined),
}));
vi.mock("./api", () => saved);

import { installWorkUploadForm } from "./installWorkUploadForm";

describe("work and upload form registration", () => {
  it("saves the existing definition as a draft, then publishes its returned ID", async () => {
    expect(await installWorkUploadForm()).toBe("saved-template-id");
    expect(saved.saveDraft).toHaveBeenCalledOnce();
    expect(saved.saveDraft).toHaveBeenCalledWith(null, expect.objectContaining({
      name: workUploadFormDefinition.name,
      sections: workUploadFormDefinition.sections,
    }), expect.any(Array));
    expect(saved.saveDraft.mock.calls[0]?.[2]).toHaveLength(workUploadFormDefinition.fields.length);
    expect(saved.publishForm).toHaveBeenCalledWith("saved-template-id");
  });
});
