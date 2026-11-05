import { z } from 'zod';
export const FOLLOWUP_PAGE_SIZE=50;
export const FOLLOWUP_FILTER_KEYS=['tab','crm','status','branch','sort','search'] as const;
export type FollowupFilters=Partial<Record<typeof FOLLOWUP_FILTER_KEYS[number],string>>;
export type FollowupPaging={page:number;total:number;counts:Record<string,number>;statuses:string[];hasOffRoster:boolean;filters:FollowupFilters;preset?:FollowupPreset|undefined};
/** Client Database presets backed by the follow-up browser (owner request 2026-11-04). */
export type FollowupPreset='not_bought'|'referrals_received'|'referrals_given';
export const FOLLOWUP_PRESETS:readonly FollowupPreset[]=['not_bought','referrals_received','referrals_given'];
export function isFollowupPreset(value:string|undefined):value is FollowupPreset{return FOLLOWUP_PRESETS.some(preset=>preset===value);}
export function followupPresetKind(preset:FollowupPreset):'not_bought'|'referral'{return preset==='not_bought'?'not_bought':'referral';}
/** Not Bought and referral lists live in Client Database: /clients?preset=...&tab=... */
export function followupHref(kind:'not_bought'|'referral',filters:FollowupFilters,page=1,preset:FollowupPreset=kind==='not_bought'?'not_bought':'referrals_received'){
 const params=new URLSearchParams();
 params.set('preset',preset);
 for(const key of FOLLOWUP_FILTER_KEYS) if(filters[key]) params.set(key,filters[key]!);
 if(page>1)params.set('page',String(page));
 return `/clients?${params}`;
}
export function followupParams(params:Record<string,string|undefined>){
 const filters:FollowupFilters={};
 for(const key of FOLLOWUP_FILTER_KEYS)if(params[key]?.trim())filters[key]=params[key]!.trim();
 return {filters,page:Math.max(1,Math.min(1000000,Number.parseInt(params.page??'1',10)||1))};
}
const common={id:z.string(),status:z.string(),next_followup_date:z.string().nullable(),remark:z.string().nullable(),action_point:z.string().nullable(),branch_id:z.string().nullable(),followup_count:z.number(),created_at:z.string().nullable(),crm_name:z.string(),history_count:z.number()};
const purchaseContext=z.object({bought_before:z.boolean(),bought_after:z.boolean()}).nullable().optional();
const referralContext=z.object({relationship:z.string().nullable(),best_time_to_call:z.string().nullable().optional(),given_by_client_code:z.string().nullable(),given_by_household_code:z.string().nullable(),given_by_referral_code:z.string().nullable(),referred_client_code:z.string().nullable()}).nullable().optional();
export const followupItemSchema=z.object({...common,purchase_context:purchaseContext,client_id:z.string(),reference_number:z.string().nullable(),client_name:z.string(),phone:z.string(),visit_date:z.string().nullable(),reason:z.string(),seen_categories:z.string(),product_requirement:z.string(),product_seen_remark:z.string(),remark_history:z.string()});
export const referralItemSchema=z.object({...common,referral_context:referralContext,referred_client_id:z.string().nullable().optional(),converted_client_id:z.string().nullable(),assigned_doer:z.string().nullable(),given_by_client_id:z.string().nullable(),given_by_name:z.string(),referral_name:z.string(),referral_number:z.string(),salesperson:z.string(),history:z.string()});
export const followupPageSchema=z.object({rows:z.array(z.unknown()),total:z.number().int().nonnegative(),counts:z.record(z.string(),z.number().int().nonnegative()),roster:z.array(z.string()),statuses:z.array(z.string()),has_off_roster:z.boolean(),branches:z.array(z.object({id:z.string(),name:z.string()})),profile:z.object({name:z.string(),role:z.string()})});
/** The Client Database address for an old /followups or /referrals link, keeping its filters and page. */
export function legacyListRedirect(preset:FollowupPreset,params:Record<string,string|string[]|undefined>){
 const first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
 const plain:Record<string,string|undefined>={};
 for(const [key,value] of Object.entries(params))plain[key]=first(value);
 const {filters,page}=followupParams(plain);
 return followupHref(followupPresetKind(preset),filters,page,preset);
}
