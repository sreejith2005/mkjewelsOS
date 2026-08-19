import {supabase} from "@jewelos/api-client";
import type {Json} from "@jewelos/core";
export type ReportCell = string | number | boolean | null;
export type ReportPayload={report_key:string;context:Record<string,ReportCell>;rows:Array<Record<string,ReportCell>>;total:number;offset:number;limit:number};
export async function fetchReport(reportKey:string,filters:Record<string,unknown>):Promise<ReportPayload>{const {data,error}=await supabase.rpc("get_report_data",{p_report_key:reportKey,p_filters:filters as Json});if(error)throw error;return data as unknown as ReportPayload;}
export async function requestExport(reportKey:string,filters:Record<string,unknown>){const {data,error}=await supabase.rpc("request_report_export_with_audit",{p_report_key:reportKey,p_filters:filters as Json,p_request_key:crypto.randomUUID()});if(error)throw error;return data;}
export async function cancelExport(id:string){const {error}=await supabase.rpc("cancel_report_export_with_audit",{p_export_id:id,p_request_key:crypto.randomUUID()});if(error)throw error;}
export async function retryExport(id:string){const {error}=await supabase.rpc("retry_report_export_with_audit",{p_export_id:id,p_request_key:crypto.randomUUID()});if(error)throw error;}
export async function signedExportUrl(id:string):Promise<string>{const {data,error}=await supabase.rpc("get_report_export_download_url",{p_export_id:id});if(error)throw error;const authorization=data as unknown as {bucket:string;object_path:string;expires_in_seconds:number};const {data:signed,error:signError}=await supabase.storage.from(authorization.bucket).createSignedUrl(authorization.object_path,authorization.expires_in_seconds);if(signError)throw signError;return signed.signedUrl;}
