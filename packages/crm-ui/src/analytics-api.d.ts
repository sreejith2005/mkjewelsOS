import type {JewelosClient} from "@jewelos/api-client";
import type {InsightsPayload} from "@jewelos/core";
export function createCrmManagementReader(options:{jewelos:JewelosClient;crmProject:{url:string;anonKey:string}}):{
 summary(context:Record<string,string|number>):Promise<InsightsPayload>;
 branches():Promise<Array<{id:string;name:string;jewelosBranchId:string|null}>>;
};
export type CrmReportCell=string|number|boolean|null;
export type CrmReportPage={rows:Array<Record<string,CrmReportCell>>;total:number;summary?:Record<string,number>};
export type CrmReportOption={id:string;name:string};
export type CrmReportOptions={branches:CrmReportOption[];employees:CrmReportOption[];crmNames:CrmReportOption[];sources:CrmReportOption[]};
export type CrmReportCustomer={client_id:string;customer_id:string;name:string;phone:string|null};
export function createCrmReportReader(options:{jewelos:JewelosClient;crmProject:{url:string;anonKey:string}}):{
 report(key:string,filters:Record<string,string>,offset:number,limit:number):Promise<CrmReportPage>;
 options():Promise<CrmReportOptions>;
 customers(search:string):Promise<CrmReportCustomer[]>;
};
