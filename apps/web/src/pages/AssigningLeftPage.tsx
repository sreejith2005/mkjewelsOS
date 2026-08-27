import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { AssigningLeftPanel } from "@/features/tasks/import/AssigningLeftPanel";
import { assignImportedTask, loadAssigningLeftTasks, loadTaskImportIdentityCandidates, type AssigningLeftRecord, type TaskImportIdentityCandidate } from "@/features/tasks/import/api";

function goToTasks(){window.history.pushState({},"","/tasks");window.dispatchEvent(new PopStateEvent("popstate"));}
export function AssigningLeftPage(){
  const {profile}=useAuth();const [records,setRecords]=useState<AssigningLeftRecord[]>([]);const [candidates,setCandidates]=useState<TaskImportIdentityCandidate[]>([]);const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const authorized=profile?["super_admin","admin"].includes(profile.user_role):false;
  const refresh=useCallback(async()=>{if(!authorized)return;setLoading(true);setError(null);try{const [nextRecords,nextCandidates]=await Promise.all([loadAssigningLeftTasks(),loadTaskImportIdentityCandidates()]);setRecords(nextRecords);setCandidates(nextCandidates);}catch(caught){setError(caught instanceof Error?caught.message:"Unable to load Assigning Left");}finally{setLoading(false);}},[authorized]);
  useEffect(()=>{void refresh();},[refresh]);
  if(!authorized)return <Notice tone="danger">Assigning Left is available only to administrators.</Notice>;
  const assign=async(recordKind:"task"|"template",recordId:string,userProfileId:string)=>{setBusy(true);setError(null);try{await assignImportedTask(recordKind,recordId,userProfileId);await refresh();}catch(caught){setError(caught instanceof Error?caught.message:"Unable to assign this record");}finally{setBusy(false);}};
  return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg p-4 text-task-text sm:-m-6 sm:p-6"><div className="mx-auto max-w-6xl space-y-5"><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Assigning Left</h1><p className="mt-1 text-sm text-task-text-muted">Tasks with blank or unclear employee names wait here safely until you choose someone.</p></div><Button onClick={goToTasks} variant="secondary"><ArrowLeft className="size-4"/>Back to tasks</Button></header><Notice tone="task">You can assign these now, later, or leave them unassigned. Unassigned recurring schedules stay paused.</Notice>{error?<div className="space-y-2"><Notice tone="danger">{error}</Notice><Button onClick={()=>void refresh()} variant="secondary"><RefreshCw className="size-4"/>Retry</Button></div>:null}{loading?<p className="text-sm text-task-text-muted">Loading Assigning Left…</p>:<AssigningLeftPanel busy={busy} candidates={candidates} onAssign={(kind,id,userId)=>void assign(kind,id,userId)} records={records}/>}</div></section>;
}
