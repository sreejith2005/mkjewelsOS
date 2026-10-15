import { describe, expect, it, vi } from "vitest";
import type { FmsTransitionRequest, FmsWorkPreview } from "@jewelos/core";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), transition: vi.fn() }));
vi.mock("./work", () => ({ previewFmsWork: mocks.preview, submitConfirmedFmsWork: mocks.transition }));
import { runFmsHandoff } from "./confirmation";
const request: FmsTransitionRequest = { kind: "complete", instanceStageId: "visit", outcome: "", remark: "", checklist: {} };
const preview: FmsWorkPreview = { fingerprint: "x", currentStageName: "Call", wouldDefer: false, destinations: [], requirements: [] };
describe("shared web/native confirmation sequence", () => {
  it("waits for confirmation and cancel makes no final server call", async () => {
    mocks.preview.mockResolvedValue(preview); mocks.transition.mockReset();
    expect(await runFmsHandoff(request, async () => null)).toBeNull();
    expect(mocks.transition).not.toHaveBeenCalled();
  });
  it("submits only after the user resolves the proposed handoff", async () => {
    mocks.preview.mockResolvedValue(preview); mocks.transition.mockReset();
    let confirm: ((choices: readonly { targetStageId: string; userProfileId: string }[]) => void) | undefined;
    const pending = runFmsHandoff(request, async () => new Promise(resolve => { confirm = resolve; }));
    await vi.waitFor(() => expect(confirm).toBeDefined());
    expect(mocks.transition).not.toHaveBeenCalled();
    confirm?.([{ targetStageId: "demo", userProfileId: "d" }]);
    await pending;
    expect(mocks.transition).toHaveBeenCalledWith(request, preview, [{ targetStageId: "demo", userProfileId: "d" }]);
  });
});
