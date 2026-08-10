import { describe, expect, it } from "vitest";
import { flowToDefinition, newFmsStage } from "./definition";
import type { FmsData, FmsFlowRow } from "./api";

describe("FMS web definition adapter", () => {
  it.each(["task","approval","form","notification","branch","parallel_start","parallel_join","end"] as const)("creates a safe %s stage", (type) => { const value = newFmsStage(type, 2); expect(value.type).toBe(type); expect(value.order).toBe(2); expect(value.key).toBe("stage_3"); });
  it("uses manager approval for approval stages", () => expect(newFmsStage("approval",0).completionRule).toBe("manager_approval"));
  it("creates a deterministic default route for branch stages", () => expect(newFmsStage("branch",0).branchRules[0]?.operator).toBe("default"));
  it("does not create human assignees for automatic stages", () => expect(newFmsStage("notification",0).assigneeRules).toEqual([]));
  it("rehydrates exact versioned graph relationships", () => {
    const flow: FmsFlowRow = { id:"f",family_id:"family",version:3,name:"Flow",description:"D",status:"draft",scope_type:"tenant",branch_id:null,department_id:null,is_active:true,usage_count:2 };
    const data = { flows:[flow], stages:[
      { id:"s1",fms_flow_id:"f",stage_key:"start",name:"Start",method:null,step_type:"task",sort_order:0,is_required:true,planned_time_rule:{minutes:60},completion_rule:"any_doer",allow_multiple_doers:false,requires_upload:false,requires_remark:false,checklist_definition:[],form_template_id:null,requires_next_doer_handoff:false,can_move_backward:false,can_reject:false,can_request_revision:false,can_escalate:false,default_next_stage_id:"s2",parallel_target_stage_ids:[],join_rule:null,join_required_stage_ids:[],split_to_flow_id:null},
      { id:"s2",fms_flow_id:"f",stage_key:"done",name:"Done",method:null,step_type:"end",sort_order:1,is_required:true,planned_time_rule:{minutes:0},completion_rule:"any_doer",allow_multiple_doers:false,requires_upload:false,requires_remark:false,checklist_definition:[],form_template_id:null,requires_next_doer_handoff:false,can_move_backward:false,can_reject:false,can_request_revision:false,can_escalate:false,default_next_stage_id:null,parallel_target_stage_ids:[],join_rule:null,join_required_stage_ids:[],split_to_flow_id:null},
    ], assignees:[{fms_stage_id:"s1",assignee_type:"reporter",user_profile_id:null,role_value:null,allow_next_selection:false,sort_order:0}], branchRules:[], forms:[], users:[], branches:[], departments:[] } satisfies FmsData;
    const definition=flowToDefinition(flow,data); expect(definition.version).toBe(3); expect(definition.stages[0]?.defaultNextStageKey).toBe("done"); expect(definition.stages[0]?.assigneeRules[0]?.type).toBe("reporter"); expect(definition.stages[1]?.type).toBe("end");
  });
});
