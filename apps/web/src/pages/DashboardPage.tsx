import {DashboardView} from "@/features/analytics/DashboardView";
import {EmployeeProgressPanel} from "@/features/analytics/EmployeeProgressPanel";
import {useAuth} from "@/auth/AuthContext";
export function DashboardPage(){const {profile}=useAuth();return <><DashboardView/>{profile?<div className="bg-task-muted px-4 pb-24 sm:px-6"><div className="mx-auto max-w-7xl"><EmployeeProgressPanel context={{preset:"today"}} role={profile.user_role}/></div></div>:null}</>;}
