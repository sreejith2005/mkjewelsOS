import { z } from 'zod';

export const CLIENT_FILTER_KEYS = ['type','stage','branch','city','state','source','potential','purchase','min_visits','max_visits','created_from','created_to','interaction_from','interaction_to','sort'] as const;
export type ClientFilters = Partial<Record<typeof CLIENT_FILTER_KEYS[number],string>>;
export function clientListHref(search: string,page: number,filters: ClientFilters = {}) {
  const params=new URLSearchParams();
  if(search) params.set('search',search);
  for(const key of CLIENT_FILTER_KEYS) if(filters[key]) params.set(key,filters[key]!);
  if(page>1) params.set('page',String(page));
  return `/clients${params.size ? `?${params}` : ''}`;
}
const rowSchema=z.object({
  client_id:z.string(),client_code:z.string(),primary_name:z.string(),primary_phone:z.string().nullable(),
  city:z.string().nullable(),state:z.string().nullable(),total_visits:z.number(),last_visit_date:z.string().nullable(),
  last_buy_status:z.string().nullable(),record_type:z.enum(['lead','client']),registered_at:z.string().nullable(),latest_interaction_at:z.string().nullable(),
});
export const clientBrowseSchema=z.object({total:z.number().int().nonnegative(),rows:z.array(rowSchema)});
