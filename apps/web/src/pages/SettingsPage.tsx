import {SettingsView} from "@/features/settings/SettingsView";
import {CustomerIntegrationHealth} from "@/features/settings/CustomerIntegrationHealth";
import {ReportDiagnostics} from "@/features/settings/ReportDiagnostics";
import {useAuth} from "@/auth/AuthContext";
import {hasPermission} from "@jewelos/core";
export function SettingsPage(){const {access,profile}=useAuth();const organization=hasPermission(access,"settings.manage_organization");const administrator=profile?.user_role==="super_admin"||profile?.user_role==="admin";
 return <><SettingsView/>{organization||administrator?<div className="mx-auto max-w-7xl px-4 pb-6">{organization?<CustomerIntegrationHealth/>:null}{administrator?<ReportDiagnostics canExportExceptions={organization&&hasPermission(access,"reports.export")}/>:null}</div>:null}</>;}
