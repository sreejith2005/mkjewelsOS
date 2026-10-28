import {lazy,Suspense,useEffect,useState} from "react";
import {CrmInsightsDashboard} from "@/components/dashboard-insights/CrmInsightsDashboard";
import {SyncHealth} from "@/components/sync-health";
import {createClient} from "@/lib/supabase/client";

const CustomerIntegrationAdmin=lazy(()=>import("@/components/customer-integration-admin").then(module=>({default:module.CustomerIntegrationAdmin})));

function DashboardWithSyncHealth(){
 const [showSync,setShowSync]=useState(false);
 useEffect(()=>{
  let active=true;
  void (async()=>{
   try {
    const {data,error}=await createClient().rpc("get_my_profile");
    if(active)setShowSync(!error&&data?.[0]?.role==="super_admin");
   } catch {
    if(active)setShowSync(false);
   }
  })();
  return()=>{active=false;};
 },[]);
 return <><CrmInsightsDashboard/>{showSync?<div className="mx-auto max-w-7xl px-4 pb-6"><details className="rounded-xl border bg-white p-4"><summary className="min-h-11 cursor-pointer text-sm font-semibold">CRM sync health</summary><SyncHealth/></details><Suspense fallback={null}><CustomerIntegrationAdmin/></Suspense></div>:null}</>;
}
// Route loaders return components; hooks run only inside the rendered child.
export default function DashboardPage(){return <DashboardWithSyncHealth/>;}
