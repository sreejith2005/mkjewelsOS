import {supabase} from "@jewelos/api-client";
import type {DashboardPayload,HomeSummary} from "./types";

export async function fetchHomeSummary():Promise<HomeSummary>{const [summary,starters]=await Promise.all([supabase.rpc("get_home_summary",{p_context:{}}),supabase.rpc("get_my_fms_starter_assignments")]);if(summary.error)throw summary.error;if(starters.error)throw starters.error;return {...summary.data as unknown as HomeSummary,fms_starters:(starters.data??[]) as HomeSummary["fms_starters"]};}
export async function fetchDashboardMetrics(context:Readonly<Record<string,string>>):Promise<DashboardPayload>{const {data,error}=await supabase.rpc("get_dashboard_metrics",{p_context:context});if(error)throw error;return data as unknown as DashboardPayload;}

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
