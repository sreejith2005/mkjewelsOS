import { describe, expect, it, vi } from "vitest";
import { FORM_LIBRARY_ROLES, type Json } from "@jewelos/core";

const api = vi.hoisted(() => ({ saveDraft: vi.fn(async (id: string | null) => id ?? "new-form"), setFormLibraryVisibility: vi.fn(async () => undefined), reviseForm: vi.fn(), duplicateForm: vi.fn(), publishForm: vi.fn(), deleteForm: vi.fn(), loadTaskForms: vi.fn() }));
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
  });

  it("falls back to every approved role when none of the chosen roles is allowed", async () => {
    const payload = { name: "x", permissions: { roles: ["doer"] } } as unknown as Json;
    await saveQuestionnaireDraft({ kind: "draft", draftId: "d1" }, payload, [] as unknown as Json, "x", async () => undefined);
    expect(api.saveDraft).toHaveBeenLastCalledWith("d1", expect.objectContaining({ permissions: { roles: [...FORM_LIBRARY_ROLES] } }), []);
  });
});
