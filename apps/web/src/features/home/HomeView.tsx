import {AlarmClock,ArrowRight,Gem} from "lucide-react";
import {useEffect} from "react";
import {useAuth} from "@/auth/AuthContext";
import {titleCase} from "@/lib/format";
import {fetchHomeSummary} from "@/features/analytics/api";
import {EmptyMessage,ErrorPanel,LoadingPanels,Panel,StatusDot} from "@/features/analytics/components";
import {useAsyncData} from "@/features/analytics/useAsyncData";
import {subscribeToInbox} from "@/features/notifications/api";
import type {HomeSummary} from "@/features/analytics/types";

function greeting(timezone:string){const hour=Number(new Intl.DateTimeFormat("en-IN",{hour:"2-digit",hour12:false,timeZone:timezone}).format(new Date()));return hour<12?"Good Morning":hour<17?"Good Afternoon":"Good Evening";}
function completion(summary:HomeSummary){const tasks=summary.tasks;return tasks.length?Math.round(tasks.filter((task)=>task.status==="completed").length/tasks.length*100):0;}

export function HomeView({onNavigate}:{onNavigate:(path:string)=>void}){
  const {branch,profile}=useAuth();
  const {data,error,loading,retry}=useAsyncData(fetchHomeSummary,[]);
  useEffect(()=>profile?.id ? subscribeToInbox(profile.id,()=>{void retry();}) : undefined,[profile?.id,retry]);
  if(loading)return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-muted p-4 sm:-m-6 sm:p-6"><LoadingPanels count={6}/></section>;
  if(error)return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-muted p-4 sm:-m-6 sm:p-6"><ErrorPanel message={error} onRetry={retry}/></section>;
  if(!data)return null;
  const completed=data.tasks.filter((task)=>task.status==="completed").length;
  const priority=data.tasks.filter((task)=>task.status!=="completed"&&task.priority==="high").slice(0,3);

  const pct=completion(data);
  return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] overflow-hidden bg-task-muted text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)]">
    <header className="bg-charcoal px-4 pb-8 pt-6 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm text-champagne/70">{greeting(data.timezone)},</p><h1 className="mt-0.5 truncate font-display text-3xl text-white">{profile?.employee_name.split(" ")[0]??"User"}</h1><div className="mt-2 flex flex-wrap gap-2 text-xs"><span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 font-medium text-gold">{titleCase(profile?.user_role??data.profile.role)}</span><span className="self-center text-champagne/65">{data.profile.branch_name??branch?.name??"Branch unavailable"}</span></div></div><div className="relative shrink-0"><div className="flex size-14 items-center justify-center rounded-2xl bg-gold text-obsidian shadow-lg shadow-gold/15"><Gem className="size-7"/></div>{data.unread_notifications>0?<span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-task-overdue text-[10px] font-bold text-white">{data.unread_notifications}</span>:null}</div></div>
        <div className="mt-6 rounded-2xl border border-gold/20 bg-obsidian/45 p-4"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-white">Today's Completion</span><span className="text-lg font-semibold text-gold">{pct}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-gold transition-[width] duration-700" style={{width:`${pct}%`}}/></div><div className="mt-4 grid grid-cols-4 gap-2"><HeroStat label="Tasks" value={data.tasks.length}/><HeroStat label="Done" value={completed}/><HeroStat label="FMS" value={data.fms_starters.length+data.fms_stages.length}/><HeroStat label="Alerts" value={data.unread_notifications}/></div></div>
      </div>
    </header>
    <div className="-mt-4 rounded-t-3xl bg-task-muted px-4 pb-24 pt-6 sm:px-6"><div className="mx-auto max-w-7xl">
      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Action required</h2><p className="mt-1 text-sm text-task-text-muted">Your assigned tasks, FMS steps, and CRM follow-ups are shown below.</p></div><AlarmClock className="size-5 text-task-accent"/></div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-task-text-muted">My Tasks</h3>
            {data.tasks.filter((t) => t.status !== "completed").length ? data.tasks.filter((t) => t.status !== "completed").slice(0, 4).map((t) => <ActionItem description={`Due ${new Date(t.due_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`} key={t.id} label={t.overdue ? "Overdue — open now" : "Assigned task"} onOpen={() => onNavigate("/tasks")} overdue={t.overdue} title={t.title} />) : <EmptyMessage>No tasks waiting.</EmptyMessage>}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-task-text-muted">FMS Tasks</h3>
            {data.fms_starters.length||data.fms_stages.length ? <>{data.fms_starters.slice(0,4).map((starter)=><ActionItem description={`Assigned ${new Date(starter.assigned_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}`} key={starter.id} label="Starting form — complete to begin" onOpen={()=>onNavigate("/forms")} overdue={false} title={starter.flow_name}/>)}{data.fms_stages.slice(0,Math.max(0,4-data.fms_starters.length)).map((stage) => <ActionItem description={`Due ${stage.planned_datetime ? new Date(stage.planned_datetime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Any time"}`} key={stage.stage_id} label={stage.sla_breached ? "SLA Breached" : "Pending step"} onOpen={() => onNavigate("/tasks/fms")} overdue={stage.sla_breached} title={`${stage.instance_title} - ${stage.stage_name}`} />)}</> : <EmptyMessage>No FMS steps waiting.</EmptyMessage>}
          </div>
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-task-text-muted">CRM Tasks</h3>
            {data.crm_followups.length ? data.crm_followups.slice(0, 4).map((followup) => <ActionItem description={`Due ${followup.due_date}`} key={followup.id} label={followup.overdue ? "Overdue — open now" : "Open follow-up"} onOpen={() => onNavigate("/crm")} overdue={followup.overdue} title={followup.subject ?? "Follow-up"} />) : <EmptyMessage>No CRM follow-ups due.</EmptyMessage>}
          </div>
        </div>
      </section>
      <section className="mt-7"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Priority Tasks Today</h2><button className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-task-accent" onClick={()=>onNavigate("/tasks")} type="button">View all<ArrowRight className="size-4"/></button></div>{priority.length?<div className="grid gap-3 lg:grid-cols-3">{priority.map((task)=><article className="rounded-xl border border-task-border bg-task-bg p-4" key={task.id}><div className="flex gap-3"><StatusDot tone={task.overdue?"danger":"warning"}/><div className="min-w-0 flex-1"><p className="truncate font-semibold">{task.title}</p><p className="mt-1 text-xs text-task-text-muted">Due {new Date(task.due_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}</p><p className="mt-2 text-xs font-medium text-task-overdue">{task.overdue?"Overdue":"High priority"}</p></div></div></article>)}</div>:<EmptyMessage>No high-priority work is waiting.</EmptyMessage>}</section>
      <section className="mt-7 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]"><Panel description="Visible only within your authorized CRM scope." title="CRM Follow-ups Due">{data.crm_followups.length?<ul className="space-y-3">{data.crm_followups.map((followup)=><li className="flex items-start gap-3" key={followup.id}><StatusDot tone={followup.overdue?"danger":"warning"}/><div><p className="text-sm font-medium">{followup.subject??"Follow-up"}</p><p className="text-xs text-task-text-muted">Due {followup.due_date}{followup.overdue?" · Overdue":""}</p></div></li>)}</ul>:<EmptyMessage>No CRM follow-ups are due.</EmptyMessage>}</Panel><Panel description="Bounded and authorized audit activity." title="Recent Activity">{data.recent_activity.length?<ul className="space-y-3">{data.recent_activity.map((activity)=><li className="flex items-start justify-between gap-3 text-sm" key={activity.id}><span><span className="font-medium">{titleCase(activity.action)}</span><span className="block text-xs text-task-text-muted">{titleCase(activity.module)}</span></span><time className="shrink-0 text-xs text-task-text-muted">{new Date(activity.created_at).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}</time></li>)}</ul>:<EmptyMessage>No recent activity.</EmptyMessage>}</Panel></section>
    </div></div>
  </section>;
}
function HeroStat({label,value}:{label:string;value:number}){return <div className="text-center"><p className="text-xl font-semibold tabular-nums text-white">{value}</p><p className="text-xs text-champagne/60">{label}</p></div>}
function ActionItem({title,description,label,overdue,onOpen}:{title:string;description:string;label:string;overdue:boolean;onOpen:()=>void}){return <button className="rounded-2xl border border-task-border bg-task-bg p-4 text-left transition hover:border-gold/50 hover:bg-task-muted" onClick={onOpen} type="button"><div className="flex gap-3"><StatusDot tone={overdue?"danger":"warning"}/><div className="min-w-0"><p className="truncate font-semibold">{title}</p><p className="mt-1 text-xs text-task-text-muted">{description}</p><p className={`mt-2 text-xs font-semibold ${overdue?"text-task-overdue":"text-task-accent"}`}>{label}</p></div></div></button>}
