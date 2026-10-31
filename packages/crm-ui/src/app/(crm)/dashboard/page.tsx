import {useEffect,useState} from "react";
import {CrmInsightsDashboard} from "@/components/dashboard-insights/CrmInsightsDashboard";
import {SyncHealth} from "@/components/sync-health";
import {createClient} from "@/lib/supabase/client";

function DashboardWithSyncHealth(){
 const [showSync,setShowSync]=useState(false);
 useEffect(()=>{let active=true;void createClient().rpc("get_my_profile").then(({data,error})=>{if(active)setShowSync(!error&&data?.[0]?.role==="super_admin");},()=>{if(active)setShowSync(false);});return()=>{active=false;};},[]);
 return <><CrmInsightsDashboard/>{showSync?<div className="mx-auto max-w-7xl px-4 pb-6"><details className="rounded-xl border bg-white p-4"><summary className="min-h-11 cursor-pointer text-sm font-semibold">CRM sync health</summary><SyncHealth/></details></div>:null}</>;
}
// Route loaders return components; hooks run only inside the rendered child.
export default function DashboardPage(){return <DashboardWithSyncHealth/>;}
