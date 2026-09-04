import {AlarmClock,ArrowRight,Gem} from "lucide-react";
import {useEffect,type ReactNode} from "react";
import {useAuth} from "@/auth/AuthContext";
import {titleCase} from "@/lib/format";
import {fetchHomeSummary} from "@/features/analytics/api";
import {EmptyMessage,ErrorPanel,LoadingPanels,Panel,StatusDot} from "@/features/analytics/components";
import {useAsyncData} from "@/features/analytics/useAsyncData";
import {subscribeToInbox} from "@/features/notifications/api";
import {useTenantRealtimeRefresh} from "@/features/realtime/useTenantRealtimeRefresh";
import type {HomeSummary} from "@/features/analytics/types";

function greeting(timezone:string){const hour=Number(new Intl.DateTimeFormat("en-IN",{hour:"2-digit",hour12:false,timeZone:timezone}).format(new Date()));return hour<12?"Good Morning":hour<17?"Good Afternoon":"Good Evening";}
function completion(summary:HomeSummary){const tasks=summary.tasks;return tasks.length?Math.round(tasks.filter((task)=>task.status==="completed").length/tasks.length*100):0;}
function when(value:string|null|undefined,fallback="Any time"){return value?new Date(value).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}):fallback;}

export function HomeView({onNavigate}:{onNavigate:(path:string)=>void}){
  const {branch,profile}=useAuth();
  const {data,error,loading,retry}=useAsyncData(fetchHomeSummary,[]);
  useEffect(()=>profile?.id ? subscribeToInbox(profile.id,()=>{void retry();}) : undefined,[profile?.id,retry]);
  useTenantRealtimeRefresh({tenantId:profile?.tenant_id,topics:["tasks","fms","crm","organization","settings"],refresh:retry});
  if(loading)return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-muted p-4 sm:-m-6 sm:p-6"><LoadingPanels count={6}/></section>;
  if(error)return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-muted p-4 sm:-m-6 sm:p-6"><ErrorPanel message={error} onRetry={retry}/></section>;
  if(!data)return null;
  const completed=data.tasks.filter((task)=>task.status==="completed").length;
  const openTasks=data.tasks.filter((task)=>task.status!=="completed");
  const priority=openTasks.filter((task)=>task.priority==="high").slice(0,3);

  const pct=completion(data);
  return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] overflow-hidden bg-task-muted text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)]">
    <header className="bg-charcoal px-4 pb-8 pt-5 sm:px-6 sm:pt-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-sm text-champagne/70">{greeting(data.timezone)},</p><h1 className="mt-0.5 truncate font-display text-2xl text-white sm:text-3xl">{profile?.employee_name.split(" ")[0]??"User"}</h1><div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 font-medium text-gold">{titleCase(profile?.user_role??data.profile.role)}</span><span className="text-champagne/65">{data.profile.branch_name??branch?.name??"Branch unavailable"}</span></div></div><div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gold text-obsidian shadow-lg shadow-gold/15 sm:size-14"><Gem className="size-6 sm:size-7"/></div></div>
        <div className="mt-5 rounded-2xl border border-gold/20 bg-obsidian/45 p-4"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium text-white">Today&apos;s Completion</span><span className="text-xl font-semibold tabular-nums text-gold">{pct}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-gold transition-[width] duration-700" style={{width:`${pct}%`}}/></div><div className="mt-4 grid grid-cols-3 gap-1 sm:gap-2"><HeroStat label="Tasks" value={data.tasks.length}/><HeroStat label="Done" value={completed}/><HeroStat label="FMS" value={data.fms_starters.length+data.fms_stages.length}/></div></div>
      </div>
    </header>
    <div className="-mt-4 rounded-t-3xl bg-task-muted px-4 pb-8 pt-6 sm:px-6"><div className="mx-auto max-w-7xl">
      <section>
        <div className="mb-3 flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-lg font-semibold">Action required</h2><p className="mt-1 text-sm text-task-text-muted">Your assigned tasks, FMS steps, and CRM follow-ups are shown below.</p></div><AlarmClock className="mt-1 size-5 shrink-0 text-task-accent"/></div>
        <div className="grid gap-5 lg:grid-cols-3">
          <ActionGroup title="My Tasks">
            {openTasks.length ? <div aria-label="All open tasks" className="max-h-80 space-y-3 overflow-y-auto overscroll-contain pr-1">{openTasks.map((t) => <ActionItem description={`Due ${when(t.due_at)}`} key={t.id} label={t.overdue ? "Overdue — open now" : "Assigned task"} onOpen={() => onNavigate("/tasks")} overdue={t.overdue} title={t.title} />)}</div> : <EmptyMessage>No tasks waiting.</EmptyMessage>}
          </ActionGroup>
          <ActionGroup title="FMS Tasks">
            {data.fms_starters.length||data.fms_stages.length ? <>{data.fms_starters.slice(0,4).map((starter)=><ActionItem description={`Assigned ${when(starter.assigned_at)}`} key={starter.id} label="Starting form — complete to begin" onOpen={()=>onNavigate("/forms")} overdue={false} title={starter.flow_name}/>)}{data.fms_stages.slice(0,Math.max(0,4-data.fms_starters.length)).map((stage) => <ActionItem description={`Due ${when(stage.planned_datetime)}`} key={stage.stage_id} label={stage.sla_breached ? "SLA Breached" : "Pending step"} onOpen={() => onNavigate("/tasks/fms")} overdue={stage.sla_breached} title={`${stage.instance_title} - ${stage.stage_name}`} />)}</> : <EmptyMessage>No FMS steps waiting.</EmptyMessage>}
          </ActionGroup>
          <ActionGroup title="CRM Tasks">
            {data.crm_followups.length ? data.crm_followups.slice(0, 4).map((followup) => <ActionItem description={`Due ${followup.due_date}`} key={followup.id} label={followup.overdue ? "Overdue — open now" : "Open follow-up"} onOpen={() => onNavigate("/crm")} overdue={followup.overdue} title={followup.subject ?? "Follow-up"} />) : <EmptyMessage>No CRM follow-ups due.</EmptyMessage>}
          </ActionGroup>
        </div>
      </section>
      <section className="mt-7"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Priority Tasks Today</h2><button className="inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-task-accent" onClick={()=>onNavigate("/tasks")} type="button">View all<ArrowRight className="size-4"/></button></div>{priority.length?<div className="grid gap-3 lg:grid-cols-3">{priority.map((task)=><article className="min-w-0 rounded-xl border border-task-border bg-task-bg p-4" key={task.id}><div className="flex gap-3"><span className="mt-1.5"><StatusDot tone={task.overdue?"danger":"warning"}/></span><div className="min-w-0 flex-1"><p className="break-words font-semibold">{task.title}</p><p className="mt-1 text-sm text-task-text-muted">Due {when(task.due_at)}</p><p className="mt-2 text-xs font-semibold text-task-overdue">{task.overdue?"Overdue":"High priority"}</p></div></div></article>)}</div>:<EmptyMessage>No high-priority work is waiting.</EmptyMessage>}</section>
      <section className="mt-7 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]"><Panel className="min-w-0" description="Visible only within your authorized CRM scope." title="CRM Follow-ups Due">{data.crm_followups.length?<ul className="space-y-3">{data.crm_followups.map((followup)=><li className="flex items-start gap-3" key={followup.id}><span className="mt-1.5"><StatusDot tone={followup.overdue?"danger":"warning"}/></span><div className="min-w-0"><p className="break-words text-sm font-medium">{followup.subject??"Follow-up"}</p><p className="text-xs text-task-text-muted">Due {followup.due_date}{followup.overdue?" · Overdue":""}</p></div></li>)}</ul>:<EmptyMessage>No CRM follow-ups are due.</EmptyMessage>}</Panel><Panel className="min-w-0" description="Bounded and authorized audit activity." title="Recent Activity">{data.recent_activity.length?<ul className="space-y-3">{data.recent_activity.map((activity)=><li className="flex items-start justify-between gap-3 text-sm" key={activity.id}><span className="min-w-0"><span className="font-medium">{titleCase(activity.action)}</span><span className="block text-xs text-task-text-muted">{titleCase(activity.module)}</span></span><time className="shrink-0 text-xs text-task-text-muted">{when(activity.created_at)}</time></li>)}</ul>:<EmptyMessage>No recent activity.</EmptyMessage>}</Panel></section>
    </div></div>
  </section>;
}
function HeroStat({label,value}:{label:string;value:number}){return <div className="min-w-0 text-center"><p className="text-2xl font-semibold leading-tight tabular-nums text-white">{value}</p><p className="truncate text-xs text-champagne/60">{label}</p></div>}
/** Grid and flex children default to `min-width: auto`, so each column needs `min-w-0` or one long task title pushes the whole row past the edge of a phone screen. */
function ActionGroup({title,children}:{title:string;children:ReactNode}){return <div className="min-w-0 space-y-3"><h3 className="text-sm font-semibold uppercase tracking-wide text-task-text-muted">{title}</h3>{children}</div>}
/** `w-full` is load-bearing: a bare `<button>` is shrink-to-fit, and wrapping text still reports its full unbroken width as the minimum, so the card would size itself to the longest title and spill off screen. */
function ActionItem({title,description,label,overdue,onOpen}:{title:string;description:string;label:string;overdue:boolean;onOpen:()=>void}){return <button className="flex w-full gap-3 rounded-2xl border border-task-border bg-task-bg p-4 text-left transition hover:border-gold/50 hover:bg-task-muted active:bg-task-muted" onClick={onOpen} type="button"><span className="mt-1.5"><StatusDot tone={overdue?"danger":"warning"}/></span><span className="min-w-0 flex-1"><span className="block break-words text-[15px] font-semibold leading-snug">{title}</span><span className="mt-1 block text-sm text-task-text-muted">{description}</span><span className={`mt-2 block text-xs font-semibold ${overdue?"text-task-overdue":"text-task-accent"}`}>{label}</span></span></button>}
