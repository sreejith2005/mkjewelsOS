import { z } from 'zod';
export const FOLLOWUP_PAGE_SIZE=50;
export const FOLLOWUP_FILTER_KEYS=['tab','crm','status','branch','sort','search'] as const;
export type FollowupFilters=Partial<Record<typeof FOLLOWUP_FILTER_KEYS[number],string>>;
export type FollowupPaging={page:number;total:number;counts:Record<string,number>;statuses:string[];hasOffRoster:boolean;filters:FollowupFilters};
export function followupHref(kind:'not_bought'|'referral',filters:FollowupFilters,page=1){
 const params=new URLSearchParams();
 for(const key of FOLLOWUP_FILTER_KEYS) if(filters[key]) params.set(key,filters[key]!);
 if(page>1)params.set('page',String(page));
 return `${kind==='not_bought'?'/followups':'/referrals'}${params.size?'?'+params:''}`;
}
export function followupParams(params:Record<string,string|undefined>){
 const filters:FollowupFilters={};
 for(const key of FOLLOWUP_FILTER_KEYS)if(params[key]?.trim())filters[key]=params[key]!.trim();
 return {filters,page:Math.max(1,Math.min(1000000,Number.parseInt(params.page??'1',10)||1))};
}
const common={id:z.string(),status:z.string(),next_followup_date:z.string().nullable(),remark:z.string().nullable(),action_point:z.string().nullable(),branch_id:z.string().nullable(),followup_count:z.number(),created_at:z.string().nullable(),crm_name:z.string(),history_count:z.number()};
export const followupItemSchema=z.object({...common,client_id:z.string(),reference_number:z.string().nullable(),client_name:z.string(),phone:z.string(),visit_date:z.string().nullable(),reason:z.string(),seen_categories:z.string(),product_requirement:z.string(),product_seen_remark:z.string(),remark_history:z.string()});
export const referralItemSchema=z.object({...common,converted_client_id:z.string().nullable(),assigned_doer:z.string().nullable(),given_by_client_id:z.string().nullable(),given_by_name:z.string(),referral_name:z.string(),referral_number:z.string(),salesperson:z.string(),history:z.string()});
export const followupPageSchema=z.object({rows:z.array(z.unknown()),total:z.number().int().nonnegative(),counts:z.record(z.string(),z.number().int().nonnegative()),roster:z.array(z.string()),statuses:z.array(z.string()),has_off_roster:z.boolean(),branches:z.array(z.object({id:z.string(),name:z.string()})),profile:z.object({name:z.string(),role:z.string()})});
