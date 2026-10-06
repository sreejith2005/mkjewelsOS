import { describe, expect, it, vi } from "vitest";
import { installWorkUploadForm } from "./installWorkUploadForm";

describe("work upload installation", () => {
  it("does not publish when saving the draft fails", async () => {
    const publishForm = vi.fn();
    await expect(installWorkUploadForm({ saveDraft: vi.fn().mockRejectedValue(new Error("Denied")), publishForm })).rejects.toThrow("Denied");
    expect(publishForm).not.toHaveBeenCalled();
  });
  it("exposes publish failure rather than reporting a usable form", async () => {
    const saveDraft = vi.fn().mockResolvedValue("persisted-draft");
    const publishForm = vi.fn().mockRejectedValue(new Error("Cannot publish"));
    await expect(installWorkUploadForm({ saveDraft, publishForm })).rejects.toThrow("Cannot publish");
    expect(publishForm).toHaveBeenCalledWith("persisted-draft");
  });
});
