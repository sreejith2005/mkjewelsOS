import {ArrowRight,Bell,CheckCircle2,ClipboardCheck,FileText,GitBranch,ListChecks,Users} from "lucide-react";
import {useAuth} from "@/auth/AuthContext";
import {titleCase} from "@/lib/format";
import {fetchHomeSummary} from "@/features/analytics/api";
import {EmptyMessage,ErrorPanel,LoadingPanels,PageHeading,PageSurface,Panel,StatusDot} from "@/features/analytics/components";
import {useAsyncData} from "@/features/analytics/useAsyncData";

const routeLabel:Record<string,string>={"/tasks/checklist":"Open my tasks","/tasks/delegation":"Review delegated work","/tasks/fms":"Open FMS tasks","/forms":"Open forms","/crm":"Open CRM","/reports":"View reports"};
function localGreeting(date:string,timezone:string){const hour=Number(new Intl.DateTimeFormat("en-IN",{hour:"2-digit",hour12:false,timeZone:timezone}).format(new Date()));return `${hour<12?"Good morning":hour<17?"Good afternoon":"Good evening"} · ${new Intl.DateTimeFormat("en-IN",{dateStyle:"full",timeZone:"UTC"}).format(new Date(`${date}T12:00:00Z`))}`;}

export function HomeView({onNavigate}: {onNavigate:(path:string)=>void}){
  const {branch,profile}=useAuth();
  const {data,error,loading,retry}=useAsyncData(fetchHomeSummary,[]);
  return <PageSurface>
    <PageHeading title="Operational Home" description={data?localGreeting(data.tenant_local_date,data.timezone):"Your authorized work at a glance"}/>
    {loading?<LoadingPanels count={6}/>:error?<ErrorPanel message={error} onRetry={retry}/>:data?<>
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-task-border bg-task-bg px-4 py-3 text-sm">
        <span className="font-semibold">{profile?.employee_name}</span><span className="text-task-text-muted">{titleCase(profile?.user_role??"")}</span><span className="text-task-text-muted">{data.profile.branch_name??branch?.name}</span><span className="text-task-text-muted">{data.profile.department_name??"No department"}</span><span className="text-task-text-muted">Availability: {data.availability_status?titleCase(data.availability_status):"Not recorded"}</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,.55fr)]">
        <div className="flex flex-col gap-4">
          <Panel title="Today's assigned tasks" description="Due today and unfinished earlier work, ordered by urgency.">
            {data.tasks.length===0?<EmptyMessage>No assigned work is waiting.</EmptyMessage>:<div className="overflow-x-auto"><table className="w-full min-w-[42rem] text-left text-sm"><thead className="text-xs text-task-text-muted"><tr><th className="pb-2 font-medium">Task</th><th className="pb-2 font-medium">Type</th><th className="pb-2 font-medium">Due</th><th className="pb-2 font-medium">Priority</th><th className="pb-2 font-medium">Checklist</th><th className="pb-2 font-medium">Status</th></tr></thead><tbody>{data.tasks.map((task)=><tr className="border-t border-task-border" key={task.id}><td className="py-3 pr-4 font-medium">{task.title}</td><td className="py-3 pr-4 text-task-text-muted">{titleCase(task.task_type)}</td><td className="py-3 pr-4">{new Date(task.due_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}</td><td className="py-3 pr-4"><span className="inline-flex items-center gap-2"><StatusDot tone={task.priority==="high"?"danger":task.priority==="medium"?"warning":"neutral"}/>{titleCase(task.priority)}</span></td><td className="py-3 pr-4">{task.checklist_completion===null?"Not applicable":`${task.checklist_completion}%`}</td><td className="py-3"><span className={task.overdue?"text-task-overdue":""}>{task.overdue?"Overdue":titleCase(task.status)}</span></td></tr>)}</tbody></table></div>}
            <button className="mt-3 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-task-accent" onClick={()=>onNavigate("/tasks/checklist")} type="button">Go to my tasks<ArrowRight className="size-4"/></button>
          </Panel>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Active FMS stages" description="Stages currently waiting for authorized action.">{data.fms_stages.length===0?<EmptyMessage>No FMS stages are waiting.</EmptyMessage>:<ul className="flex flex-col gap-3">{data.fms_stages.map((stage)=><li className="flex items-start gap-3" key={stage.stage_id}><StatusDot tone={stage.sla_breached?"danger":"success"}/><div className="min-w-0"><p className="truncate text-sm font-medium">{stage.stage_name}</p><p className="text-xs text-task-text-muted">{stage.reference_number} · {titleCase(stage.status)}{stage.sla_breached?" · SLA breached":""}</p></div></li>)}</ul>}</Panel>
            <Panel title="Forms awaiting submission" description="Exact task-linked forms only.">{data.forms_awaiting_submission.length===0?<EmptyMessage>No linked forms are waiting.</EmptyMessage>:<ul className="flex flex-col gap-3">{data.forms_awaiting_submission.map((form)=><li className="flex items-start gap-3" key={form.task_id}><FileText className="size-4 shrink-0 text-task-accent"/><div><p className="text-sm font-medium">{form.form_name}</p><p className="text-xs text-task-text-muted">For {form.task_title} · due {new Date(form.due_at).toLocaleDateString("en-IN")}</p></div></li>)}</ul>}</Panel>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {[{label:"Work shown",value:data.tasks.length,Icon:ListChecks},{label:"FMS active",value:data.fms_stages.length,Icon:GitBranch},{label:"Forms waiting",value:data.forms_awaiting_submission.length,Icon:ClipboardCheck},{label:"Unread",value:data.unread_notifications,Icon:Bell}].map(({label,value,Icon})=><div className="rounded-xl border border-task-border bg-task-bg p-4" key={label}><Icon className="size-5 text-task-accent"/><p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p><p className="text-xs text-task-text-muted">{label}</p></div>)}
          </div>
          {data.crm_followups.length>0?<Panel title="CRM follow-ups due" description="Visible only within authorized CRM scope."><ul className="flex flex-col gap-3">{data.crm_followups.map((followup)=><li className="flex items-start gap-3" key={followup.id}><StatusDot tone={followup.overdue?"danger":"warning"}/><div><p className="text-sm font-medium">{followup.subject??"Follow-up"}</p><p className="text-xs text-task-text-muted">Due {followup.due_date}{followup.overdue?" · Overdue":""}</p></div></li>)}</ul></Panel>:null}
          <Panel title="Quick links" description="Navigation only; actions continue in their real workflows."><div className="flex flex-col gap-1">{data.quick_actions.map((path)=>{const Icon=path==="/crm"?Users:path.includes("fms")?GitBranch:path==="/forms"?FileText:path==="/reports"?ClipboardCheck:CheckCircle2;return <button className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-left text-sm font-medium hover:bg-task-muted" key={path} onClick={()=>onNavigate(path)} type="button"><Icon className="size-4 text-task-text-muted"/><span className="flex-1">{routeLabel[path]??"Open workspace"}</span><ArrowRight className="size-4 text-task-text-muted"/></button>;})}</div></Panel>
          <Panel title="Recent activity" description="Bounded, authorized audit activity without record payloads.">{data.recent_activity.length===0?<EmptyMessage>No recent activity.</EmptyMessage>:<ul className="flex flex-col gap-3">{data.recent_activity.map((activity)=><li className="flex items-start justify-between gap-3 text-sm" key={activity.id}><span><span className="font-medium">{titleCase(activity.action)}</span><span className="block text-xs text-task-text-muted">{titleCase(activity.module)}</span></span><time className="shrink-0 text-xs text-task-text-muted">{new Date(activity.created_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}</time></li>)}</ul>}</Panel>
        </div>
      </div>
    </>:null}
  </PageSurface>;
}
