import { assertCrmRead, readCrmResults } from "@/crm-port/read-results";
import { getCrmUser } from "@/crm-port/crm-user";
import { CLIENT_PAGE_SIZE, ClientDatabase } from "@/components/client-database";

import { createClient } from "@/lib/supabase/server";
import { CLIENT_FILTER_KEYS, clientBrowseSchema, type ClientFilters } from "@/lib/client-browse";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string,string | undefined>> }) {
  const params=await searchParams;
  const search=params.search?.trim() ?? "";
  const page=Math.max(1,Number.parseInt(params.page ?? "1",10)||1);
  const filters: ClientFilters={};
  for(const key of CLIENT_FILTER_KEYS) if(params[key]?.trim()) filters[key]=params[key]!.trim();
  const db=await createClient();
  const [{data},{data:profiles},{data:auth},{data:branches}]=await readCrmResults([
    db.rpc("browse_crm_records",{p_filters:{...filters,search},p_offset:(page-1)*CLIENT_PAGE_SIZE,p_limit:CLIENT_PAGE_SIZE}),
    db.rpc("get_my_profile"),getCrmUser(db),db.from("branches").select("id,name").eq("active",true).order("name"),
  ]);
  const result=clientBrowseSchema.parse(data);
  const {data:user}=auth.user ? assertCrmRead(await db.from("users").select("branch_id").eq("id",auth.user.id).single()) : {data:null};
  return <ClientDatabase clients={result.rows} search={search} filters={filters} paging={{page,clientTotal:result.total,leadCount:0}} walkinContext={{role:profiles?.[0]?.role ?? "",branchId:user?.branch_id ?? null,branches:branches ?? []}}/>;

}
