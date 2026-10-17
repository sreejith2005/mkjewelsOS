import { describe, expect, it } from "vitest";
import { upgradeFmsAssignmentContract } from "./assignmentUpgrade";
import type { FmsFlowDefinition } from "./types";
const flow = { lifecycle: "draft", assignmentVersion: 1, stages: [
  {key:"initial",type:"form",formTemplateId:"form",defaultNextStageKey:"call",branchRules:[],parallelTargetStageKeys:[],sla:{},assigneeRules:[]},
  {key:"call",type:"task",branchRules:[],parallelTargetStageKeys:[],sla:{pipelineName:"Sales"},assigneeRules:[{type:"specific_user",userProfileId:"named",fallbackUserProfileId:"cover"}]},
] } as unknown as FmsFlowDefinition;
describe("explicit assignment upgrade",()=>{
  it("infers a single source while preserving defaults and the original legacy definition",()=>{
    const original=structuredClone(flow);
    const next=upgradeFmsAssignmentContract(flow,{form:[{key:"owner",label:"Owner",type:"user_dropdown",required:true,shown:true}]});
    expect(next.assignmentVersion).toBe(2);
    expect(next.stages[1]?.sla.assignment?.sources[0]?.sourceStageKey).toBe("initial");
    expect(next.stages[1]?.assigneeRules).toEqual(flow.stages[1]?.assigneeRules);
    expect(next.stages[1]?.sla.pipelineName).toBe("Sales");
    expect(next.stages[0]?.sla.completionFormRequired).toBe(true);
    expect(flow).toEqual(original);
  });
  it("retains existing assignment rules when a source is ambiguous",()=>{
    expect(upgradeFmsAssignmentContract(flow,{}).stages[1]?.sla.assignment?.mode).toBe("hierarchy");
  });
  it("refuses to mutate a published contract",()=>{
    expect(()=>upgradeFmsAssignmentContract({...flow,lifecycle:"published"},{})).toThrow("draft revision");
  });
});
