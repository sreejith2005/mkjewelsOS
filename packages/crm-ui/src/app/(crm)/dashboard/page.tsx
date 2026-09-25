import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { DashboardFilter } from "@/components/dashboard-filter";
import { TrendChart } from "@/components/trend-chart";
import { StatusDistributionChart } from "@/components/status-distribution-chart";
import { buildDashboardData, dashboardRange, endExclusive, startInclusive } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";

const statLabels = [["walkIns", "TOTAL WALK-INS"], ["notBought", "TOTAL NOT BOUGHT"], ["bought", "TOTAL BOUGHT"], ["orderPlaced", "TOTAL ORDER PLACE"], ["repairPlaced", "TOTAL REPAIR PLACE"], ["orderPickup", "TOTAL ORDER PICK UP"], ["repairPickup", "TOTAL REPAIR PICKUP"], ["upsale", "TOTAL UPSALE"], ["productReturn", "TOTAL PRODUCT RETURN"]] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ mode?: string; startDate?: string; endDate?: string }> }) {
  const params = await searchParams;
  const range = dashboardRange(params);
  const from = startInclusive(range);
  const until = endExclusive(range);
  const supabase = await createClient();
  const visits = [];
  // No branch predicate: dashboard viewing remains global for every active role.
  for (let offset = 0; ; offset += 1000) {
    let visitsQuery = supabase.from("client_timeline").select("id,event_date,created_at,event_type,buy_status,branch_id,crm_name,remark,reference_number,client_id,branch:branches(name),client:clients(primary_name),salesperson:users(name)").order("event_date", { ascending: false }).range(offset, offset + 999);
    if (from && until) visitsQuery = visitsQuery.gte("event_date", from).lt("event_date", until);
    const response = await visitsQuery;
    const page = response.data ?? [];
    visits.push(...page);
    if (page.length < 1000) break;
  }
  const today = dashboardRange({ mode: "MONTH" }).end;
  const data = buildDashboardData(visits, today);
  const rangeDescription = range.mode === "ALL" ? "ALL DATA" : `${displayKolkataDate(range.start)} TO ${displayKolkataDate(range.end)}`;

  return <main className="mx-auto max-w-7xl px-5 py-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="mt-1 text-3xl font-semibold">DASHBOARD</h1><p className="mt-2 text-stone-600">WALK-IN SUMMARY, CLIENT METRICS, BRANCH / CRM BREAKDOWN, AND RECENT VISITS.</p><p className="mt-1 text-sm text-stone-600">FILTER: {range.mode} | {rangeDescription}</p></div><DashboardFilter mode={range.mode} startDate={params.startDate ?? ""} endDate={params.endDate ?? ""} /></div>
    <section className="mt-6"><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{statLabels.map(([key, label]) => <article className="rounded-xl border bg-white p-4" key={key}><p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p><p className="mt-2 text-3xl font-semibold">{data.totals[key]}</p></article>)}</div></section>
    <section className="mt-7 grid gap-6 lg:grid-cols-2"><Panel title="WALK-IN TREND"><TrendChart points={data.trend} /></Panel><Panel title="WALK-IN STATUS DISTRIBUTION"><StatusDistributionChart total={data.totals.walkIns} items={data.statusDistribution} /></Panel></section>
    <section className="mt-7 grid gap-6 lg:grid-cols-2"><Breakdown title="BRANCH BREAKDOWN" rows={data.branchBreakdown} /><Breakdown title="CRM BREAKDOWN" rows={data.crmBreakdown} /></section>
    <section className="mt-7 overflow-hidden rounded-xl border bg-white"><div className="border-b p-4"><h2 className="text-lg font-semibold">RECENT VISITS</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-600"><tr><th className="p-3">DATE</th><th className="p-3">CLIENT ID</th><th className="p-3">TYPE</th><th className="p-3">STATUS</th><th className="p-3">BRANCH</th><th className="p-3">CRM</th><th className="p-3">REMARK</th></tr></thead><tbody>{data.recentVisits.length ? data.recentVisits.map((visit) => <tr className="border-t" key={visit.id}><td className="p-3">{displayKolkataDate(visit.event_date)}</td><td className="p-3"><Link className="font-medium text-amber-800 underline" href={`/clients/${visit.client_id}`}>{visit.client_id}</Link></td><td className="p-3">{visit.event_type.replaceAll("_", " ")}</td><td className="p-3">{visit.buy_status?.replaceAll("_", " ") ?? "-"}</td><td className="p-3">{visit.branch?.name ?? "-"}</td><td className="p-3">{visit.crm_name ?? "-"}</td><td className="max-w-64 truncate p-3" title={visit.remark ?? undefined}>{visit.remark ?? "-"}</td></tr>) : <tr><td className="p-5 text-stone-600" colSpan={7}>NO VISITS FOUND.</td></tr>}</tbody></table></div></section>
  </main>;
}

function displayKolkataDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-xl border bg-white"><div className="border-b p-4"><h2 className="text-lg font-semibold">{title}</h2></div>{children}</section>;
}

function Breakdown({ title, rows }: { title: string; rows: { name: string; visits: number }[] }) {
  return <section className="overflow-hidden rounded-xl border bg-white"><div className="border-b p-4"><h2 className="text-lg font-semibold">{title}</h2></div><table className="w-full text-left text-sm"><thead className="bg-stone-50 text-xs uppercase text-stone-600"><tr><th className="p-3">NAME</th><th className="p-3">COUNT</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr className="border-t" key={row.name}><td className="p-3 font-medium">{row.name}</td><td className="p-3">{row.visits}</td></tr>) : <tr><td colSpan={2} className="p-5 text-stone-600">NO VISITS FOUND.</td></tr>}</tbody></table></section>;
}
