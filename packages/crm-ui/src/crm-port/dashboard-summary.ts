import { z } from 'zod';
const breakdown=z.array(z.object({name:z.string(),visits:z.number().int().nonnegative()}));
export const dashboardSummarySchema=z.object({
 statuses:z.array(z.object({status:z.string(),n:z.number().int().nonnegative()})),
 trend:z.array(z.object({day:z.string(),total:z.number(),bought:z.number(),notBought:z.number()})),
 branchBreakdown:breakdown,crmBreakdown:breakdown,
 recentVisits:z.array(z.object({reference_number:z.string().nullable(),id:z.string(),client_id:z.string(),event_date:z.string(),created_at:z.string(),event_type:z.string(),buy_status:z.string().nullable(),branch_id:z.string(),crm_name:z.string().nullable(),remark:z.string().nullable(),branch:z.object({name:z.string()}).nullable()})),
});
