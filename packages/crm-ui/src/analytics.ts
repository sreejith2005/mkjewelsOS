import type {JewelosClient} from "@jewelos/api-client";
import {parseInsightsPayload,type InsightsPayload} from "@jewelos/core";
import {createCrmProjectClient,crmTokenSource,type CrmProjectConfig} from "./crm-port/crm-project";
export function createCrmManagementReader(options:{jewelos:JewelosClient;crmProject:CrmProjectConfig}){
 const source=crmTokenSource({config:options.crmProject,jewelosAccessToken:async()=>{const {data,error}=await options.jewelos.auth.getSession();if(error)throw error;return data.session?.access_token??null;}});
 const client=createCrmProjectClient({config:options.crmProject,source});
 return {async summary(context:Record<string,string|number>):Promise<InsightsPayload>{const {data,error}=await client.rpc("get_crm_insights_v1",{p_context:context});if(error)throw error;return parseInsightsPayload(data);},
 async branches():Promise<Array<{id:string;name:string;jewelosBranchId:string|null}>>{const {data,error}=await client.rpc("get_crm_insights_options_v1");if(error)throw error;if(!data||typeof data!=="object"||Array.isArray(data)||!Array.isArray(data.branches))throw new Error("CRM branch mapping unavailable");return data.branches.map(b=>{if(!b||typeof b!=="object"||Array.isArray(b)||typeof b.id!=="string"||typeof b.name!=="string"||(b.jewelos_branch_id!==null&&typeof b.jewelos_branch_id!=="string"))throw new Error("Invalid branch mapping");return{id:b.id,name:b.name,jewelosBranchId:b.jewelos_branch_id};});}};
}
