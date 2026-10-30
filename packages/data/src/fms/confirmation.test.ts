import { describe, expect, it, vi } from "vitest";
import type { FmsHandoffDecision, FmsTransitionRequest, FmsWorkPreview } from "@jewelos/core";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), transition: vi.fn(), recover: vi.fn().mockResolvedValue(null) }));
vi.mock("./work", () => ({ previewFmsWork: mocks.preview, submitConfirmedFmsWork: mocks.transition, recoverFmsWork: mocks.recover, fmsRequestTarget: () => "visit" }));
import { runFmsHandoff } from "./confirmation";
const request: FmsTransitionRequest = { kind: "complete", instanceStageId: "visit", outcome: "", remark: "", checklist: {} };
const preview: FmsWorkPreview = { fingerprint: "x", currentStageName: "Call", wouldDefer: false, destinations: [], requirements: [] };
describe("shared web/native confirmation sequence", () => {
  it("recovers a durable completed request before attempting an actionable preview", async () => {
    const result = { state: "workflow_completed" };
    mocks.recover.mockResolvedValueOnce(result); mocks.preview.mockClear(); mocks.transition.mockClear();
    const choose = vi.fn();
    expect(await runFmsHandoff(request, choose)).toEqual(result);
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(choose).not.toHaveBeenCalled();
    expect(mocks.transition).not.toHaveBeenCalled();
  });
  it("waits for confirmation and cancel makes no final server call", async () => {
    mocks.preview.mockResolvedValue(preview); mocks.transition.mockReset();
    expect(await runFmsHandoff(request, async () => null)).toBeNull();
    expect(mocks.transition).not.toHaveBeenCalled();
  });
  it("submits only after the user resolves the proposed handoff", async () => {
    mocks.preview.mockResolvedValue(preview); mocks.transition.mockReset();
    let confirm: ((decision: FmsHandoffDecision) => void) | undefined;
    const pending = runFmsHandoff(request, async () => new Promise(resolve => { confirm = resolve; }));
    await vi.waitFor(() => expect(confirm).toBeDefined());
    expect(mocks.transition).not.toHaveBeenCalled();
    const confirmedPreview = { ...preview, fingerprint: "confirmed-choices-and-coverage" };
    confirm?.({ handoffs: [{ targetStageId: "demo", userProfileId: "d" }], preview: confirmedPreview });
    await pending;
    expect(mocks.transition).toHaveBeenCalledWith(request, confirmedPreview, [{ targetStageId: "demo", userProfileId: "d" }]);
  });
  it("submits straight away when the answer reaches an End Node and nobody receives work", async () => {
    const ending = { ...preview, terminal: { stageName: "Lead Closed", outcome: "lost" as const } };
    mocks.preview.mockResolvedValue(ending); mocks.transition.mockReset(); mocks.transition.mockResolvedValue({ state: "workflow_completed" });
    const choose = vi.fn();
    await runFmsHandoff(request, choose);
    expect(choose).not.toHaveBeenCalled();
    expect(mocks.transition).toHaveBeenCalledWith(request, ending, []);
  });
  it("still asks when an End Node is reached on one branch but another person receives work", async () => {
    const mixed = { ...preview, terminal: { stageName: "Lead Closed", outcome: "lost" as const }, destinations: [{ targetStageId: "s", stageName: "Next", formTemplateId: null, selectedUserId: null, effectiveUserId: "u", employeeName: "U", assignmentMethod: "fixed_employee", locked: false, allowHandoff: true, issue: null }] };
    mocks.preview.mockResolvedValue(mixed); mocks.transition.mockReset();
    const choose = vi.fn().mockResolvedValue(null);
    await runFmsHandoff(request, choose);
    expect(choose).toHaveBeenCalledOnce();
  });
});
