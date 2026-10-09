import {getSupabase} from "@jewelos/api-client/client";
import {parseSavedView,type DashboardViewConfig,type DashboardSavedView} from "@jewelos/core";
export async function listDashboardViews():Promise<DashboardSavedView[]>{const {data,error}=await getSupabase().from("dashboard_saved_views").select("id,name,config,record_version").order("name");if(error)throw error;return (data??[]).map(parseSavedView);}
export async function saveDashboardView(name:string,config:DashboardViewConfig,existing?:DashboardSavedView){const {data,error}=await getSupabase().rpc("save_dashboard_view_with_audit",{...(existing?{p_id:existing.id,p_expected_version:existing.record_version}:{}),p_name:name,p_config:config});if(error)throw error;return parseSavedView(data);}
export async function deleteDashboardView(view:DashboardSavedView){const {error}=await getSupabase().rpc("delete_dashboard_view_with_audit",{p_id:view.id,p_expected_version:view.record_version});if(error)throw error;}
