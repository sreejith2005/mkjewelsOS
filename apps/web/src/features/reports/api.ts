import {supabase} from "@jewelos/api-client";
import type {Json} from "@jewelos/core";
export type ReportCell = string | number | boolean | null;
/** A form answer as shown in the full-answer view (form_answers rows). */
export type ReportAnswer = {label:string;value:string};
export type ReportServerColumn = {key:string;label:string;phone?:boolean;instant?:boolean};
export type ReportRow = Record<string,ReportCell|ReportAnswer[]>;
export type ReportPayload={report_key:string;context?:Record<string,ReportCell>;rows:ReportRow[];total:number;offset?:number;limit?:number;columns?:ReportServerColumn[];summary?:Record<string,number>};
export type ReportOption={id:string;name:string};
export type ReportFilterOptions={forms:ReportOption[];flows:ReportOption[];stages:ReportOption[];employees:ReportOption[]};

export async function fetchReport(reportKey:string,filters:Record<string,unknown>):Promise<ReportPayload>{const {data,error}=await supabase.rpc("get_report_data",{p_report_key:reportKey,p_filters:filters as Json});if(error)throw error;return data as unknown as ReportPayload;}
export async function requestExport(reportKey:string,filters:Record<string,unknown>){const {data,error}=await supabase.rpc("request_report_export_with_audit",{p_report_key:reportKey,p_filters:filters as Json,p_request_key:crypto.randomUUID()});if(error)throw error;return data;}
/** CRM-owned reports go through the existing customer export path (re-authorized in the CRM when the job runs). */
export async function requestCrmExport(reportKey:string,filters:Record<string,string>){const {data,error}=await supabase.rpc("request_customer_export",{p_key:reportKey,p_filters:filters,p_request_key:crypto.randomUUID()});if(error)throw error;return data;}
export async function cancelExport(id:string){const {error}=await supabase.rpc("cancel_report_export_with_audit",{p_export_id:id,p_request_key:crypto.randomUUID()});if(error)throw error;}
export async function retryExport(id:string){const {error}=await supabase.rpc("retry_report_export_with_audit",{p_export_id:id,p_request_key:crypto.randomUUID()});if(error)throw error;}
export async function signedExportUrl(id:string):Promise<string>{const {data,error}=await supabase.rpc("get_report_export_download_url",{p_export_id:id});if(error)throw error;const authorization=data as unknown as {bucket:string;object_path:string;expires_in_seconds:number};const {data:signed,error:signError}=await supabase.storage.from(authorization.bucket).createSignedUrl(authorization.object_path,authorization.expires_in_seconds);if(signError)throw signError;return signed.signedUrl;}

const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const optionList=(value:unknown):ReportOption[]=>Array.isArray(value)?value.flatMap((raw)=>{const item=record(raw);return typeof item.id==="string"&&typeof item.name==="string"?[{id:item.id,name:item.name}]:[];}):[];
/** Forms, workflows, their stages and employees the reader may filter by (names only, in scope). */
export async function fetchReportFilterOptions(flowFamilyId?:string):Promise<ReportFilterOptions>{
  const args:{p_flow_family_id?:string}=flowFamilyId?{p_flow_family_id:flowFamilyId}:{};
  const {data,error}=await supabase.rpc("get_report_filter_options",args);
  if(error)throw error;
  const payload=record(data);
  return {forms:optionList(payload.forms),flows:optionList(payload.flows),stages:optionList(payload.stages),employees:optionList(payload.employees)};
}
