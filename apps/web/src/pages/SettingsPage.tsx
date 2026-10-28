import {SettingsView} from "@/features/settings/SettingsView";
import {CustomerIntegrationHealth} from "@/features/settings/CustomerIntegrationHealth";
import {useAuth} from "@/auth/AuthContext";
import {hasPermission} from "@jewelos/core";
export function SettingsPage(){const {access}=useAuth();return <><SettingsView/>{hasPermission(access,"settings.manage_organization")?<div className="mx-auto max-w-7xl px-4 pb-6"><CustomerIntegrationHealth/></div>:null}</>;}
