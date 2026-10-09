import {lazy,Suspense} from "react";
import {hasPermission} from "@jewelos/core";
import {useAuth} from "@/auth/AuthContext";
import {ManagementDashboard} from "./insights/ManagementDashboard";
const CrmSummary=lazy(()=>import("./insights/CrmSummary").then(m=>({default:m.CrmSummary})));
export function DashboardView(){const {access}=useAuth();return <ManagementDashboard crmAllowed={!!access&&hasPermission(access,"crm.view")} renderCrmSummary={filter=><Suspense fallback={<p>Loading CRM summary?</p>}><CrmSummary filter={filter}/></Suspense>}/>;}
