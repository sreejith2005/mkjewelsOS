import type {JewelosClient} from "@jewelos/api-client";
import type {InsightsPayload} from "@jewelos/core";
export function createCrmManagementReader(options:{jewelos:JewelosClient;crmProject:{url:string;anonKey:string}}):{
 summary(context:Record<string,string|number>):Promise<InsightsPayload>;
 branches():Promise<Array<{id:string;name:string;jewelosBranchId:string|null}>>;
};
