import { getSupabase } from "@jewelos/api-client/client";
import { FMS_STAGE_TYPES, type Json } from "@jewelos/core";
import type { FmsChecklistItem, FmsData, FmsEvidence, FmsInstance, FmsInstanceStage, FmsStageRow } from "./api";

const invalid = () => new Error("Invalid assigned workflow response. Refresh this assignment.");
function obj(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(); return v as Record<string, unknown>; }
function str(v: unknown): string { if (typeof v !== "string") throw invalid(); return v; }
function num(v: unknown): number { if (typeof v !== "number" || !Number.isFinite(v)) throw invalid(); return v; }
function bool(v: unknown): boolean { if (typeof v !== "boolean") throw invalid(); return v; }
function maybe<T>(v: unknown, read: (v: unknown) => T): T | null { return v == null ? null : read(v); }
function list<T>(v: unknown, read: (v: unknown) => T): T[] { if (!Array.isArray(v)) throw invalid(); return v.map(read); }
function choice<T extends string>(v: unknown, values: readonly T[]): T { const found = values.find(x => x === v); if (!found) throw invalid(); return found; }
function json(v: unknown): Json { if (v === null || typeof v === "string" || typeof v === "boolean") return v; if (typeof v === "number") return num(v); if (Array.isArray(v)) return v.map(json); return Object.fromEntries(Object.entries(obj(v)).map(([k,x]) => [k,json(x)])); }
export function parseFmsAssignedStage(raw: unknown) {
  const b = obj(raw); const i = obj(b.instance);
  const instance: FmsInstance = { id: str(i.id), fms_flow_id: str(i.fms_flow_id), reference_number: str(i.reference_number), title: str(i.title),
    status: choice(i.status,["active","completed","cancelled","on_hold","overdue"]), priority: maybe(i.priority,x => choice(x,["high","medium","low"])), context: json(i.context),
    branch_id: maybe(i.branch_id,str), department_id: maybe(i.department_id,str), started_by: str(i.started_by), started_at: maybe(i.started_at,str), completed_at: maybe(i.completed_at,str),
    parent_instance_id: maybe(i.parent_instance_id,str), flow_version: num(i.flow_version), assignment_version: num(i.assignment_version), execution_version: num(i.execution_version) };
  const instanceStages = list(b.instanceStages, raw => { const s=obj(raw); return { id:str(s.id),fms_instance_id:str(s.fms_instance_id),fms_stage_id:str(s.fms_stage_id),status:str(s.status),assigned_to:maybe(s.assigned_to,x=>list(x,str)),planned_datetime:maybe(s.planned_datetime,str),actual_datetime:maybe(s.actual_datetime,str),delay_minutes:maybe(s.delay_minutes,num),sla_breached:maybe(s.sla_breached,bool),form_submission_id:maybe(s.form_submission_id,str),remark:maybe(s.remark,str),outcome:maybe(s.outcome,str),completed_by:maybe(s.completed_by,str),escalation_count:num(s.escalation_count),visit_number:num(s.visit_number),execution_scope_id:maybe(s.execution_scope_id,str) } satisfies FmsInstanceStage; });
  const definitions = list(b.definitions,raw=>{const s=obj(raw); const position=maybe(s.canvas_position,obj); return {
    id:str(s.id),fms_flow_id:str(s.fms_flow_id),stage_key:str(s.stage_key),name:str(s.name),method:maybe(s.method,str),step_type:choice(s.step_type,FMS_STAGE_TYPES),sort_order:num(s.sort_order),is_required:bool(s.is_required),planned_time_rule:json(s.planned_time_rule),completion_rule:maybe(s.completion_rule,x=>choice(x,["all_doers","any_doer","manager_approval"])),allow_multiple_doers:maybe(s.allow_multiple_doers,bool),requires_upload:maybe(s.requires_upload,bool),requires_remark:maybe(s.requires_remark,bool),checklist_definition:json(s.checklist_definition),form_template_id:maybe(s.form_template_id,str),requires_next_doer_handoff:maybe(s.requires_next_doer_handoff,bool),can_move_backward:maybe(s.can_move_backward,bool),can_reject:maybe(s.can_reject,bool),can_request_revision:maybe(s.can_request_revision,bool),can_escalate:maybe(s.can_escalate,bool),default_next_stage_id:maybe(s.default_next_stage_id,str),parallel_target_stage_ids:list(s.parallel_target_stage_ids??[],str),join_rule:maybe(s.join_rule,x=>choice(x,["all","any","specific"])),join_required_stage_ids:maybe(s.join_required_stage_ids,x=>list(x,str)),split_to_flow_id:maybe(s.split_to_flow_id,str),canvas_position:position?{x:num(position.x),y:num(position.y)}:null
  } satisfies FmsStageRow; });
  const checklist=list(b.checklist,raw=>{const s=obj(raw);return {id:str(s.id),fms_instance_stage_id:str(s.fms_instance_stage_id),item_key:str(s.item_key),label:str(s.label),is_required:bool(s.is_required),is_completed:bool(s.is_completed),sort_order:num(s.sort_order)} satisfies FmsChecklistItem;});
  const evidence=list(b.evidence,raw=>{const s=obj(raw);return {id:str(s.id),fms_instance_stage_id:str(s.fms_instance_stage_id),storage_path:str(s.storage_path),original_filename:str(s.original_filename),mime_type:str(s.mime_type),size_bytes:num(s.size_bytes),uploaded_by:str(s.uploaded_by),created_at:str(s.created_at)} satisfies FmsEvidence;});
  const users:FmsData["users"]=list(b.users,raw=>{const s=obj(raw);return {id:str(s.id),employee_name:str(s.employee_name),user_role:str(s.user_role),branch_id:str(s.branch_id),department_id:str(s.department_id),working_status:str(s.working_status),is_login_enabled:maybe(s.is_login_enabled,bool),account_status:str(s.account_status)};});
  return {instance,instanceStages,definitions,checklist,evidence,users};
}
export async function loadFmsAssignedStage(instanceId:string,instanceStageId?:string) {
  const result=await getSupabase().rpc("get_fms_assigned_stage",{p_instance_id:instanceId,...(instanceStageId?{p_instance_stage_id:instanceStageId}:{})});
  if(result.error) throw new Error(result.error.message);
  return result.data === null ? null : parseFmsAssignedStage(result.data);
}
