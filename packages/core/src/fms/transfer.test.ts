import { describe, expect, it } from "vitest";
import { createFmsFragment, describeFmsPasteReport, exportFmsWorkflow, FmsTransferError, fmsConnectionsTouching, parseFmsTransfer, pasteFmsFragment, removeFmsStages } from "./transfer";
import { fmsDefinitionFingerprint } from "./definitionDiff";
import { normalizeFmsDefinition, validateFmsDefinition } from "./engine";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types";

const FORM = "11111111-1111-4111-8111-111111111111";
const OTHER_FORM = "22222222-2222-4222-8222-222222222222";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GONE_USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stage = (key: string, order: number, patch: Partial<FmsStageDefinition> = {}): FmsStageDefinition => ({
  key, name: key[0]!.toUpperCase() + key.slice(1), type: "task", order, required: true, completionRule: "any_doer", allowMultipleDoers: false,
  requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [], requiresNextDoerHandoff: false, canMoveBackward: false,
  canReject: false, canRequestRevision: false, canEscalate: false, branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [],
  sla: { dueDate: "", deadlineEnabled: false }, ...patch,
});

/** Introduction → Proposal → Negotiation, with a Yes/No route from Introduction. */
const sales: FmsFlowDefinition = {
  assignmentVersion: 2, name: "Sales", scope: "tenant", manualTrigger: true,
  stages: [
    stage("start", 0, { type: "form", formTemplateId: FORM, defaultNextStageKey: "introduction" }),
    stage("introduction", 1, {
      formTemplateId: FORM, assigneeRules: [{ type: "specific_user", userProfileId: USER }],
      branchRules: [{ id: "r-yes", source: "form_answer", sourceKey: "interested", operator: "equals", value: "yes", nextStageKey: "proposal", order: 0 }],
      defaultNextStageKey: "followup", sla: { dueDate: "", deadlineEnabled: false, questionnaire: { origin: "stage", draftFormId: "33333333-3333-4333-8333-333333333333" } },
    }),
    stage("proposal", 2, { defaultNextStageKey: "negotiation", sla: { dueDate: "", deadlineEnabled: true, timingMethod: "tat_hours", tatMinutes: 120, triggerStageKey: "introduction" } }),
    stage("negotiation", 3, { assigneeRules: [{ type: "specific_user", userProfileId: GONE_USER }] }),
    stage("followup", 4),
  ],
};
const positions = new Map([["start", { x: 60, y: 100 }], ["introduction", { x: 360, y: 100 }], ["proposal", { x: 660, y: 100 }], ["negotiation", { x: 960, y: 100 }], ["followup", { x: 660, y: 260 }]]);
let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

describe("FMS copy and paste", () => {
  it("duplicates connected steps with fresh keys and ids, internal links remapped, external ones cut", () => {
    const fragment = createFmsFragment(sales, ["introduction", "proposal", "negotiation"], positions);
    expect(fragment.stages.map((item) => item.position)).toEqual([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 600, y: 0 }]);
    // A private draft of the next questionnaire version never travels.
    expect(fragment.stages[0]!.sla.questionnaire).toEqual({ origin: "stage" });

    const { definition, pastedKeys, report } = pasteFmsFragment(sales, fragment.stages, { anchor: { x: 400, y: 500 }, newId, availableFormIds: [FORM], availableUserIds: [USER] });
    expect(pastedKeys).toEqual(["stage_6", "stage_7", "stage_8"]);
    const [intro, proposal, negotiation] = pastedKeys.map((key) => definition.stages.find((item) => item.key === key)!);
    expect(intro!.branchRules[0]!.nextStageKey).toBe("stage_7");
    expect(intro!.branchRules[0]!.id).not.toBe("r-yes");
    // The "otherwise" link pointed at a step that was not copied: it is cut, never re-pointed.
    expect(intro!.defaultNextStageKey).toBeUndefined();
    expect(proposal!.defaultNextStageKey).toBe("stage_8");
    expect(proposal!.sla.triggerStageKey).toBe("stage_6");
    expect(intro!.sla.questionnaire).toEqual({ origin: "copied" });
    expect(negotiation!.assigneeRules).toEqual([]);
    expect(intro!.position).toEqual({ x: 400, y: 500 });
    expect(negotiation!.position).toEqual({ x: 1000, y: 500 });
    expect(report).toEqual({ unresolvedRoutes: 0, droppedLinks: 1, removedFormIds: [], removedAssignees: 1, removedSources: 0 });
    // The originals are untouched and nothing connects them to the copies.
    expect(definition.stages.slice(0, 5)).toEqual(sales.stages);
    expect(definition.stages.slice(0, 5).some((item) => item.defaultNextStageKey?.startsWith("stage_"))).toBe(false);
    expect(describeFmsPasteReport(report)).toContain("1 named person is not active here");
  });

  it("keeps a route whose destination was not copied, without a destination, and drops forms the destination cannot use", () => {
    const fragment = createFmsFragment(sales, ["introduction"], positions);
    const { definition, report } = pasteFmsFragment({ ...sales, stages: [] }, fragment.stages, { anchor: { x: 0, y: 0 }, newId, availableFormIds: [OTHER_FORM] });
    const pasted = definition.stages[0]!;
    expect(pasted.branchRules).toHaveLength(1);
    expect(pasted.branchRules[0]!.nextStageKey).toBeUndefined();
    expect(pasted.branchRules[0]!.sourceKey).toBe("interested");
    expect(pasted.formTemplateId).toBeUndefined();
    expect(pasted.sla.questionnaire).toBeUndefined();
    expect(report.unresolvedRoutes).toBe(1);
    expect(report.removedFormIds).toEqual([FORM]);
    expect(validateFmsDefinition(definition).map((issue) => issue.code)).toContain("route_without_destination");
  });

  it("round-trips through clipboard text, and a pasted stage passes the same validation as a hand-made one", () => {
    const text = JSON.stringify(createFmsFragment(sales, ["proposal", "negotiation"], positions));
    const parsed = parseFmsTransfer(text);
    expect(parsed.kind).toBe("fragment");
    expect(parsed.name).toBe("Sales");
    const { definition } = pasteFmsFragment(sales, parsed.stages, { anchor: { x: 0, y: 900 }, newId });
    expect(normalizeFmsDefinition(definition).stages).toHaveLength(7);
  });
});

describe("FMS workflow export and import validation", () => {
  it("exports definitions only and parses them back", () => {
    const exported = exportFmsWorkflow({ ...sales, id: "flow-id", branchId: "branch", departmentId: "department", moduleContext: "crm" }, positions, new Date("2026-10-23T00:00:00Z"));
    expect(Object.keys(exported.workflow)).toEqual(["name", "assignmentVersion", "stages"]);
    expect(JSON.stringify(exported)).not.toContain("33333333-3333");
    const parsed = parseFmsTransfer(JSON.stringify(exported));
    expect(parsed).toMatchObject({ kind: "workflow", name: "Sales", assignmentVersion: 2 });
    expect(parsed.stages.map((item) => item.key)).toEqual(["start", "introduction", "proposal", "negotiation", "followup"]);
  });

  it.each([
    ["", "empty"],
    ["not json", "not workflow JSON"],
    [JSON.stringify({ nodes: [], connections: {} }), "n8n workflow files are not supported"],
    [JSON.stringify({ format: "mkjewels.fms.fragment", version: 2, stages: [] }), "Unsupported workflow file version 2"],
    [JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: [] }), "no steps"],
    [JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: [{ ...stage("a", 0), type: "end" }] }), "Step 1.type"],
    [JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: [{ ...stage("a", 0), instanceId: "x" }] }), "unexpected field instanceId"],
    [JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: [stage("a", 0), stage("a", 1)] }), "appears twice"],
    [JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: [{ ...stage("a", 0), key: "Bad Key" }] }), "stable identifier"],
    [JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: [{ ...stage("a", 0), sla: { dueDate: "", submissions: [] } }] }), "unexpected field submissions"],
    [JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: Array.from({ length: 201 }, (_, index) => stage(`s${index}`, index)) }), "at most 200"],
  ])("refuses %#", (text, message) => {
    expect(() => parseFmsTransfer(text)).toThrow(FmsTransferError);
    expect(() => parseFmsTransfer(text)).toThrow(message);
  });

  it("drops an imported questionnaire draft id", () => {
    const text = JSON.stringify({ format: "mkjewels.fms.fragment", version: 1, stages: [{ ...stage("a", 0), sla: { dueDate: "", questionnaire: { origin: "stage", draftFormId: "33333333-3333-4333-8333-333333333333" } } }] });
    expect(parseFmsTransfer(text).stages[0]!.sla.questionnaire).toEqual({ origin: "stage" });
  });
});

describe("FMS multi-step delete", () => {
  it("removes the steps and their connections without re-wiring the rest", () => {
    expect(fmsConnectionsTouching(sales.stages, ["proposal", "negotiation"])).toBe(2);
    const stages = removeFmsStages(sales.stages, ["proposal", "negotiation"]);
    expect(stages.map((item) => item.key)).toEqual(["start", "introduction", "followup"]);
    const intro = stages.find((item) => item.key === "introduction")!;
    expect(intro.branchRules).toEqual([]);
    expect(intro.defaultNextStageKey).toBe("followup");
  });
});

describe("questionnaire metadata", () => {
  it("survives normalization but never changes the fingerprint the AI assistant compares", () => {
    const withMarker = normalizeFmsDefinition(sales);
    expect(withMarker.stages[1]!.sla.questionnaire).toEqual({ origin: "stage", draftFormId: "33333333-3333-4333-8333-333333333333" });
    const without = { ...sales, stages: sales.stages.map((item) => ({ ...item, sla: { ...item.sla, questionnaire: undefined } })) };
    expect(fmsDefinitionFingerprint(sales)).toBe(fmsDefinitionFingerprint(without));
  });

  it("blocks publishing while questionnaire changes are only a draft", () => {
    expect(validateFmsDefinition(sales).map((issue) => issue.code)).toContain("questionnaire_draft_pending");
  });
});
