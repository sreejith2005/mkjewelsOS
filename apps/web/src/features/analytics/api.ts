import {supabase} from "@jewelos/api-client";
import type {DashboardPayload,EmployeeProgress,HomeSummary} from "./types";

export async function fetchHomeSummary():Promise<HomeSummary>{const [summary,starters]=await Promise.all([supabase.rpc("get_home_summary",{p_context:{}}),supabase.rpc("get_my_fms_starter_assignments")]);if(summary.error)throw summary.error;if(starters.error)throw starters.error;const base=summary.data as unknown as HomeSummary;const starterRows=starters.data??[];const stageIds=base.fms_stages.map((stage)=>stage.stage_id);const instances=await supabase.from("fms_instance_stages").select("id,fms_stage_id").in("id",stageIds);if(instances.error)throw instances.error;const byRuntime=new Map((instances.data??[]).map((row)=>[row.id,row.fms_stage_id]));const definitions=await supabase.from("fms_stages").select("id,form_template_id").in("id",[...byRuntime.values()]);if(definitions.error)throw definitions.error;const formByStage=new Map((definitions.data??[]).map((row)=>[row.id,row.form_template_id]));const formIds=[...new Set([...starterRows.map((starter)=>starter.form_template_id),...base.fms_stages.flatMap((stage)=>{const id=byRuntime.get(stage.stage_id);const form=id?formByStage.get(id):null;return form?[form]:[];})])];const forms=await supabase.from("form_templates").select("id,name").in("id",formIds);if(forms.error)throw forms.error;const names=new Map((forms.data??[]).map((form)=>[form.id,form.name]));return {...base,fms_stages:base.fms_stages.map((stage)=>{const formTemplateId=formByStage.get(byRuntime.get(stage.stage_id)??"")??null;return {...stage,form_template_id:formTemplateId,form_name:formTemplateId?names.get(formTemplateId)??null:null};}),fms_starters:starterRows.map((starter)=>({...starter,form_name:names.get(starter.form_template_id)??"Pinned form unavailable"})) as HomeSummary["fms_starters"]};}
export async function fetchDashboardMetrics(context:Readonly<Record<string,string>>):Promise<DashboardPayload>{const {data,error}=await supabase.rpc("get_dashboard_metrics",{p_context:context});if(error)throw error;return data as unknown as DashboardPayload;}
export async function fetchEmployeeTaskProgress(context:Readonly<Record<string,string>>):Promise<EmployeeProgress>{const {data,error}=await supabase.rpc("get_employee_task_progress" as never,{p_context:context} as never);if(error)throw error;return data as EmployeeProgress;}

export type ReportingOptions = {
  branches: Array<{id:string;name:string}>;
  departments: Array<{id:string;name:string;branch_id:string|null}>;
};

export async function fetchReportingOptions():Promise<ReportingOptions>{
  const [branches,departments]=await Promise.all([
    supabase.from("branches").select("id,name").eq("is_active",true).order("name"),
    supabase.from("departments").select("id,name,branch_id").eq("is_active",true).order("name"),
  ]);
  const error=branches.error??departments.error;
  if(error)throw error;
  return {branches:branches.data??[],departments:departments.data??[]};
}
