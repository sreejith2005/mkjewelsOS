import { describe, expect, it } from "vitest";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types";
import { simulateFmsDefinition } from "./simulation";
const stage = (key: string, patch: Partial<FmsStageDefinition> = {}): FmsStageDefinition => ({ key, name: key, type: "task", order: 0, required: true, completionRule: "any_doer", allowMultipleDoers: false, requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [{type:"specific_user",userProfileId:"default"}], requiresNextDoerHandoff:false,canMoveBackward:false,canReject:false,canRequestRevision:false,canEscalate:false,branchRules:[],parallelTargetStageKeys:[],joinRequiredStageKeys:[],sla:{},...patch });
const flow = (stages: FmsStageDefinition[]): FmsFlowDefinition => ({name:"Simulation",scope:"tenant",manualTrigger:true,assignmentVersion:2,stages:stages.map((s,order)=>({...s,order}))});
describe("workflow authoring simulation",()=>{
  it("normalizes hidden answers using the pinned Form definition", () => {
    const result = simulateFmsDefinition(flow([stage("initial", { type: "form", formTemplateId: "form", defaultNextStageKey: "call" }), stage("call", { sla: { assignment: { mode: "previous_form", allowHandoff: false, sources: [{ sourceStageKey: "initial", formTemplateId: "form", fieldKey: "owner" }], fallbackRule: { type: "specific_user", userProfileId: "C" } } } })]), { starterId: "A", answers: { initial: [{ owner: "B" }] }, forms: { form: { name: "Pinned", fields: [{ key: "owner", label: "Owner", type: "user_dropdown", sortOrder: 0, shown: false }] } } });
    expect(result.events.at(-1)?.selectedUserId).toBe("C");
  });
  it("respects the first matched route when selecting a source question", () => {
    const result = simulateFmsDefinition(flow([stage("initial", { formTemplateId: "form", defaultNextStageKey: "call", branchRules: [{ id: "no", order: 0, source: "outcome", operator: "equals", value: "no", nextStageKey: "call" }] }), stage("call", { sla: { assignment: { mode: "previous_form", allowHandoff: false, sources: [{ sourceStageKey: "initial", formTemplateId: "form", fieldKey: "owner", routeRuleId: "yes" }], fallbackRule: { type: "specific_user", userProfileId: "C" } } } })]), { starterId: "A", answers: { initial: [{ owner: "B" }] }, outcomes: { initial: ["no"] } });
    expect(result.events.at(-1)?.selectedUserId).toBe("C");
  });
  it("never uses answers from a skipped conditional form", () => {
    const result = simulateFmsDefinition(flow([
      stage("initial", { defaultNextStageKey: "conditional" }),
      stage("conditional", { formTemplateId: "form", defaultNextStageKey: "call", sla: { conditional: { decisionStageKey: "initial", decisionOptionKey: "yes" } } }),
      stage("call", { sla: { assignment: { mode: "previous_form", allowHandoff: false, sources: [{ sourceStageKey: "conditional", formTemplateId: "form", fieldKey: "owner" }], fallbackRule: { type: "specific_user", userProfileId: "C" } } } }),
    ]), { starterId: "A", outcomes: { initial: ["no"] }, answers: { conditional: [{ owner: "B" }] } });
    expect(result.events.at(-1)?.selectedUserId).toBe("C");
  });
  it("shows every fixed doer instead of silently choosing the first", () => {
    const result = simulateFmsDefinition(flow([stage("initial", { defaultNextStageKey: "multi" }), stage("multi", { allowMultipleDoers: true, assigneeRules: [{ type: "specific_user", userProfileId: "B" }, { type: "specific_user", userProfileId: "C" }], sla: { assignment: { mode: "fixed_employee", allowHandoff: false, sources: [] } } })]), { starterId: "A", answers: {} });
    expect(result.events.at(-1)?.selectedUserIds).toEqual(["B", "C"]);
    expect(result.events.at(-1)?.selectedUserId).toBeNull();
  });
  it("traces successive form answers ahead of ordinary defaults without writing data",()=>{
    const result=simulateFmsDefinition(flow([stage("initial",{type:"form",formTemplateId:"form",defaultNextStageKey:"call"}),stage("call",{sla:{assignment:{mode:"previous_form",allowHandoff:true,sources:[{sourceStageKey:"initial",formTemplateId:"form",fieldKey:"owner"}]}}})]),{starterId:"A",answers:{initial:[{owner:"B"}]}});
    expect(result.events.map(event=>event.selectedUserId)).toEqual(["A","B"]);
    expect(result.limitReached).toBe(false);
  });
  it("bounds a human loop and gives every visit its own identity",()=>{
    const result=simulateFmsDefinition(flow([stage("loop",{defaultNextStageKey:"loop"})]),{starterId:"A",answers:{},maxEvents:3});
    expect(result.events.map(event=>event.visit)).toEqual([1,2,3]);expect(result.limitReached).toBe(true);
  });
  it("keeps a fixed employee despite a supplied handoff",()=>{
    const result=simulateFmsDefinition(flow([stage("initial",{defaultNextStageKey:"locked"}),stage("locked",{sla:{assignment:{mode:"fixed_employee",allowHandoff:true,sources:[]}}})]),{starterId:"A",answers:{},handoffs:{locked:["forged"]}});
    expect(result.events[1]?.selectedUserId).toBe("default");
  });
  it("releases an any-branch join only once per split visit",()=>{
    const result=simulateFmsDefinition(flow([stage("split",{type:"parallel_start",parallelTargetStageKeys:["a","b"]}),stage("a",{defaultNextStageKey:"join"}),stage("b",{defaultNextStageKey:"join"}),stage("join",{type:"parallel_join",joinRule:"any",defaultNextStageKey:"finish"}),stage("finish")]),{answers:{}});
    expect(result.events.filter(event=>event.stageKey==="finish")).toHaveLength(1);
  });
  it("collapses an inner join back into its parent branch",()=>{
    const result=simulateFmsDefinition(flow([stage("outer",{type:"parallel_start",parallelTargetStageKeys:["inner","right"]}),stage("inner",{type:"parallel_start",parallelTargetStageKeys:["a","b"]}),stage("right",{defaultNextStageKey:"outer_join"}),stage("a",{defaultNextStageKey:"inner_join"}),stage("b",{defaultNextStageKey:"inner_join"}),stage("inner_join",{type:"parallel_join",joinRule:"all",defaultNextStageKey:"outer_join"}),stage("outer_join",{type:"parallel_join",joinRule:"all",defaultNextStageKey:"finish"}),stage("finish")]),{answers:{}});
    expect(result.events.filter(event=>event.stageKey==="finish")).toHaveLength(1);
  });
});
