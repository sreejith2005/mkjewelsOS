import { assertCrmRead, readCrmResults } from "@/crm-port/read-results";
import { CLIENT_PAGE_SIZE, ClientDatabase } from "@/components/client-database";
import { ClientWorkspace } from "@/components/client-workspace";
import { FollowupQueue } from "@/components/followup-queue";
import { ReferralQueue } from "@/components/referral-queue";
import { FOLLOWUP_PAGE_SIZE, followupItemSchema, followupPageSchema, followupParams, followupPresetKind, isFollowupPreset, referralItemSchema, type FollowupPreset } from "@/crm-port/followup-page";

import { createClient } from "@/lib/supabase/server";
import { CLIENT_FILTER_KEYS, clientBrowseSchema, type ClientFilters } from "@/lib/client-browse";

// crm-port: Not Bought follow-ups and both sides of referrals are Client Database views (owner
// request 2026-11-04). Each view reads its own bounded server page; nothing is joined in the browser.
async function FollowupView({ preset, params }: { preset: FollowupPreset; params: Record<string, string | undefined> }) {
  const kind = followupPresetKind(preset);
  const { filters, page } = followupParams(params);
  // Referrals given lead with the referrer: sorted by the client who gave them unless chosen otherwise.
  if (preset === "referrals_given" && !filters.sort) filters.sort = "given_by";
  const db = await createClient();
  const { data } = assertCrmRead(await db.rpc("browse_crm_followups", { p_kind: kind, p_filters: filters, p_offset: (page - 1) * FOLLOWUP_PAGE_SIZE, p_limit: FOLLOWUP_PAGE_SIZE }));
  const result = followupPageSchema.parse(data);
  const paging = { page, total: result.total, counts: result.counts, statuses: result.statuses, hasOffRoster: result.has_off_roster, filters, preset };
  return <ClientWorkspace preset={preset}>{kind === "not_bought"
    ? <FollowupQueue embedded items={result.rows.map((row) => followupItemSchema.parse(row))} crmNames={result.roster} branches={result.branches} role={result.profile.role} branchId={null} enteredByName={result.profile.name} paging={paging} />
    : <ReferralQueue embedded view={preset === "referrals_given" ? "given" : "received"} items={result.rows.map((row) => referralItemSchema.parse(row))} rosterNames={result.roster} branches={result.branches} role={result.profile.role} branchId={null} enteredByName={result.profile.name} paging={paging} />}</ClientWorkspace>;
}

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string,string | undefined>> }) {
  const params=await searchParams;
  if (isFollowupPreset(params.preset)) return FollowupView({ preset: params.preset, params });
  const search=params.search?.trim() ?? "";
  const page=Math.max(1,Number.parseInt(params.page ?? "1",10)||1);
  const filters: ClientFilters={};
  for(const key of CLIENT_FILTER_KEYS) if(params[key]?.trim()) filters[key]=params[key]!.trim();
  const db=await createClient();
  const [{data},{data:profiles},{data:ownBranch},{data:branches}]=await readCrmResults([
    db.rpc("browse_crm_records_page",{p_filters:{...filters,search},p_offset:(page-1)*CLIENT_PAGE_SIZE,p_limit:CLIENT_PAGE_SIZE}),
    db.rpc("get_my_profile"),db.rpc("current_user_branch_id"),db.from("branches").select("id,name").eq("active",true).order("name"),
  ]);
  const result=clientBrowseSchema.parse(data);
  return <ClientDatabase clients={result.rows} search={search} filters={filters} paging={{page,clientTotal:result.total,leadCount:0}} walkinContext={{role:profiles?.[0]?.role ?? "",branchId:ownBranch ?? null,branches:branches ?? []}}/>;

}
