import { describe, expect, it, vi } from "vitest";
import { FORM_LIBRARY_ROLES, type Json } from "@jewelos/core";

const api = vi.hoisted(() => ({ saveDraft: vi.fn(async (id: string | null) => id ?? "new-form"), setFormLibraryVisibility: vi.fn(async () => undefined), setFormFamilyPlacement: vi.fn(async () => undefined), reviseForm: vi.fn(), duplicateForm: vi.fn(), publishForm: vi.fn(), deleteForm: vi.fn(), loadTaskForms: vi.fn() }));
vi.mock("@/features/forms/api", () => api);

import { blankQuestionnaire, saveQuestionnaireDraft } from "./questionnaire";

describe("FMS step questionnaire saving", () => {
  it("starts a new questionnaire with only the roles the server accepts", () => {
    expect(blankQuestionnaire("Introduction call", "Sales").permissions?.roles).toEqual([...FORM_LIBRARY_ROLES]);
  });

  it("never sends a role the server rejects, so the first save cannot fail on permissions", async () => {
    const onCreated = vi.fn(async () => undefined);
    const payload = { name: "Introduction call", permissions: { roles: ["staff", "doer", "housekeeping", "hr", "staff"] } } as unknown as Json;
    await saveQuestionnaireDraft({ kind: "new" }, payload, [] as unknown as Json, "Introduction call", onCreated);
    expect(api.saveDraft).toHaveBeenCalledWith(null, expect.objectContaining({ permissions: { roles: ["staff"] } }), []);
    expect(onCreated).toHaveBeenCalledWith("new-form");
    // 0399: a questionnaire made in a step stays under FMS workflow forms.
    expect(api.setFormFamilyPlacement).toHaveBeenCalledWith("new-form", "fms");
  });

  it("marks a private copy of a library form as an FMS workflow form, but not a revision of the step's own form", async () => {
    api.duplicateForm.mockResolvedValueOnce("copy-1");
    api.reviseForm.mockResolvedValueOnce("rev-1");
    api.setFormFamilyPlacement.mockClear();
    await saveQuestionnaireDraft({ kind: "copy", publishedId: "lib-1" }, { name: "x" } as unknown as Json, [] as unknown as Json, "x", async () => undefined);
    expect(api.setFormFamilyPlacement).toHaveBeenCalledWith("copy-1", "fms");
    await saveQuestionnaireDraft({ kind: "revise", publishedId: "own-1" }, { name: "x" } as unknown as Json, [] as unknown as Json, "x", async () => undefined);
    expect(api.setFormFamilyPlacement).not.toHaveBeenCalledWith("rev-1", "fms");
  });

  it("falls back to every approved role when none of the chosen roles is allowed", async () => {
    const payload = { name: "x", permissions: { roles: ["doer"] } } as unknown as Json;
    await saveQuestionnaireDraft({ kind: "draft", draftId: "d1" }, payload, [] as unknown as Json, "x", async () => undefined);
    expect(api.saveDraft).toHaveBeenLastCalledWith("d1", expect.objectContaining({ permissions: { roles: [...FORM_LIBRARY_ROLES] } }), []);
  });
});
