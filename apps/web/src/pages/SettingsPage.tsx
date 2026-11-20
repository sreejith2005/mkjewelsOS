import {SettingsView} from "@/features/settings/SettingsView";
import {ReportDiagnostics} from "@/features/settings/ReportDiagnostics";
import {useAuth} from "@/auth/AuthContext";
export function SettingsPage(){const {profile}=useAuth();const administrator=profile?.user_role==="super_admin"||profile?.user_role==="admin";
 return <><SettingsView/>{administrator?<div className="space-y-4 pt-4">{administrator?<ReportDiagnostics/>:null}</div>:null}</>;}
