import { getSupabase as db } from "@jewelos/api-client/client";
import type {DashboardPayload,EmployeeProgress,HomeSummary} from "./types";

/**
 * `get_home_summary` returns runtime stages without the form their definition
 * pins, so Home alone could not tell "open the workflow" from "complete this
 * exact form". Resolve the pinned template here, once, so every client routes
 * assigned FMS work through the same identity (see `fmsAssignedWorkPath`).
 */
export async function fetchHomeSummary():Promise<HomeSummary>{
  const [summary,starters]=await Promise.all([db().rpc("get_home_summary",{p_context:{}}),db().rpc("get_my_fms_starter_assignments")]);
  if(summary.error)throw summary.error;
  if(starters.error)throw starters.error;
  const base=summary.data as unknown as HomeSummary;
  const starterRows=(starters.data??[]) as Array<{id:string;form_template_id:string}>;

  const runtimeStageIds=base.fms_stages.map((stage)=>stage.stage_id);
  const runtime=runtimeStageIds.length
    ? await db().from("fms_instance_stages").select("id,fms_stage_id").in("id",runtimeStageIds)
    : {data:[],error:null};
  if(runtime.error)throw runtime.error;
  const definitionByRuntime=new Map((runtime.data??[]).map((row)=>[row.id,row.fms_stage_id]));

  const definitionIds=[...new Set(definitionByRuntime.values())];
  const definitions=definitionIds.length
    ? await db().from("fms_stages").select("id,form_template_id").in("id",definitionIds)
    : {data:[],error:null};
  if(definitions.error)throw definitions.error;
  const formByDefinition=new Map((definitions.data??[]).map((row)=>[row.id,row.form_template_id]));

  const formIds=[...new Set([
    ...starterRows.map((starter)=>starter.form_template_id),
    ...base.fms_stages.flatMap((stage)=>{
      const form=formByDefinition.get(definitionByRuntime.get(stage.stage_id)??"");
      return form?[form]:[];
    }),
  ])];
  const forms=formIds.length
    ? await db().from("form_templates").select("id,name").in("id",formIds)
    : {data:[],error:null};
  if(forms.error)throw forms.error;
  const nameByForm=new Map((forms.data??[]).map((form)=>[form.id,form.name]));

  return {
    ...base,
    fms_stages:base.fms_stages.map((stage)=>{
      const formTemplateId=formByDefinition.get(definitionByRuntime.get(stage.stage_id)??"")??null;
      return {...stage,form_template_id:formTemplateId,form_name:formTemplateId?nameByForm.get(formTemplateId)??null:null};
    }),
    fms_starters:starterRows.map((starter)=>({
      ...starter,
      form_name:nameByForm.get(starter.form_template_id)??"Pinned form unavailable",
    })) as HomeSummary["fms_starters"],
  };
}
export async function fetchDashboardMetrics(context:Readonly<Record<string,string>>):Promise<DashboardPayload>{const {data,error}=await db().rpc("get_dashboard_metrics",{p_context:context});if(error)throw error;return data as unknown as DashboardPayload;}
export async function fetchEmployeeTaskProgress(context:Readonly<Record<string,string>>):Promise<EmployeeProgress>{const {data,error}=await db().rpc("get_employee_task_progress" as never,{p_context:context} as never);if(error)throw error;return data as EmployeeProgress;}

export type ReportingOptions = {
  branches: Array<{id:string;name:string}>;
  departments: Array<{id:string;name:string;branch_id:string|null}>;
};

export async function fetchReportingOptions():Promise<ReportingOptions>{
  const [branches,departments]=await Promise.all([
    db().from("branches").select("id,name").eq("is_active",true).order("name"),
    db().from("departments").select("id,name,branch_id").eq("is_active",true).order("name"),
  ]);
  const error=branches.error??departments.error;
  if(error)throw error;
  return {branches:branches.data??[],departments:departments.data??[]};
}
