import {AlertTriangle,ArrowRight,Gem} from "lucide-react";
import {useEffect} from "react";
import {useAuth} from "@/auth/AuthContext";
import {titleCase} from "@/lib/format";
import {fetchHomeSummary} from "@/features/analytics/api";
import {ErrorPanel,LoadingPanels,StatusDot} from "@/features/analytics/components";
import {useAsyncData} from "@/features/analytics/useAsyncData";
import {subscribeToInbox} from "@/features/notifications/api";
import {useTenantRealtimeRefresh} from "@/features/realtime/useTenantRealtimeRefresh";
import type {HomeSummary} from "@/features/analytics/types";
import {HomeTeamSection,useTeamToday} from "./HomeTeam";
import {HomeWorkCards} from "./HomeWorkCards";

function greeting(timezone:string){const hour=Number(new Intl.DateTimeFormat("en-IN",{hour:"2-digit",hour12:false,timeZone:timezone}).format(new Date()));return hour<12?"Good Morning":hour<17?"Good Afternoon":"Good Evening";}
function completion(summary:HomeSummary){const tasks=summary.tasks;return tasks.length?Math.round(tasks.filter((task)=>task.status==="completed").length/tasks.length*100):0;}
function when(value:string|null|undefined,fallback="Any time"){return value?new Date(value).toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"}):fallback;}

export function HomeView({onNavigate}:{onNavigate:(path:string)=>void}){
  const {branch,profile}=useAuth(); const {data,error,loading,retry}=useAsyncData(fetchHomeSummary,[profile?.id]); const {team,refresh:refreshTeam}=useTeamToday(profile?.user_role);
  useEffect(()=>profile?.id ? subscribeToInbox(profile.id,()=>{void retry();}) : undefined,[profile?.id,retry]);
  useTenantRealtimeRefresh({tenantId:profile?.tenant_id,topics:["tasks","fms","crm","organization","settings"],refresh:()=>{refreshTeam();return retry();}});
  if(loading)return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-muted p-4 sm:-m-6 sm:p-6"><LoadingPanels count={6}/></section>;
  if(error)return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-muted p-4 sm:-m-6 sm:p-6"><ErrorPanel message={error} onRetry={retry}/></section>;
  if(!data)return null;
  const completed=data.tasks.filter((task)=>task.status==="completed").length; const openTasks=data.tasks.filter((task)=>task.status!=="completed"); const priority=openTasks.filter((task)=>task.priority==="high").slice(0,3);
  // A leader with no work of their own sees the team's day in the hero instead of zeros.
  const teamHero=team&&data.tasks.length===0?team.summary:null; const pct=teamHero?(teamHero.assigned?Math.round(teamHero.completed/teamHero.assigned*100):0):completion(data);
  // Home is a command centre: a slim header with today's progress, what needs attention now,
  // the three work cards, and (for leaders) the team's day. Nothing is shown twice.
  const attention=[...openTasks.filter((task)=>task.overdue),...priority.filter((task)=>!task.overdue)].slice(0,4);
  return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] overflow-hidden bg-task-muted text-task-text sm:-m-6 md:min-h-[calc(100vh-4rem)]">
    <header className="surface-dark relative overflow-hidden bg-obsidian px-4 pb-8 pt-4 dark:bg-charcoal sm:px-6 sm:pt-6 lg:pb-9"><div aria-hidden className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-[radial-gradient(circle,rgb(var(--color-gold)/0.18),transparent_70%)]"/><div className="relative mx-auto grid max-w-[110rem] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,32rem)] lg:items-center"><div className="flex min-w-0 items-center gap-3"><div className="hidden size-12 shrink-0 items-center justify-center rounded-2xl bg-gold-sheen text-on-gold shadow-gold ring-1 ring-gold-secondary/40 sm:flex"><Gem className="size-6"/></div><div className="min-w-0"><p className="text-sm text-champagne/70">{greeting(data.timezone)},</p><h1 className="truncate font-display text-[1.75rem] font-semibold leading-tight text-white sm:text-[2.1rem]">{profile?.employee_name.split(" ")[0]??"User"}</h1><div className="mt-1 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 font-medium text-gold-secondary">{titleCase(profile?.user_role??data.profile.role)}</span><span className="text-champagne/65">{data.profile.branch_name??branch?.name??"Branch unavailable"}</span></div></div></div><div className="rounded-2xl border border-gold/20 bg-charcoal/70 p-3.5 shadow-lift backdrop-blur-sm sm:p-4"><div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-medium text-white">{teamHero?"Team completion today":"Today’s Completion"}</span><span className="text-xl font-semibold tabular-nums text-gold-secondary">{pct}%</span></div><div className="h-2 overflow-hidden rounded-full bg-white/15"><div className="bg-gold-sheen h-full rounded-full transition-[width] duration-700" style={{width:`${pct}%`}}/></div><div className="mt-3 grid grid-cols-3 divide-x divide-gold/15">{teamHero?<><HeroStat label="Team tasks" value={teamHero.assigned}/><HeroStat label="Done" value={teamHero.completed}/><HeroStat label="Overdue" value={teamHero.overdue}/></>:<><HeroStat label="Tasks" value={data.tasks.length}/><HeroStat label="Done" value={completed}/><HeroStat label="FMS" value={data.fms_starters.length+data.fms_stages.length}/></>}</div></div></div></header>
    <div className="relative -mt-5 rounded-t-[1.75rem] bg-task-muted px-4 pb-8 pt-5 sm:px-6"><div className="mx-auto max-w-[110rem] space-y-6">
      {attention.length?<section aria-labelledby="home-attention-heading" className="rounded-2xl border border-task-overdue/25 bg-task-bg p-3 shadow-card sm:p-4"><div className="mb-2 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-semibold" id="home-attention-heading"><AlertTriangle aria-hidden className="size-4 text-task-overdue"/>Needs attention now</h2><button className="group inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold text-gold-secondary transition-colors hover:bg-gold/10" onClick={()=>onNavigate("/tasks")} type="button">View all<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5"/></button></div><ul className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-4">{attention.map((task)=>{const path=`/tasks?task_id=${encodeURIComponent(task.id)}`;return <li className="min-w-0" key={task.id}><a className="flex min-h-14 items-start gap-2.5 rounded-xl border border-task-border px-3 py-2 transition-colors hover:border-gold/40 hover:bg-gold/5" href={path} onClick={(event)=>{event.preventDefault();onNavigate(path);}}><span className="mt-1.5"><StatusDot tone={task.overdue?"danger":"warning"}/></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{task.title}</span><span className="block truncate text-xs text-task-text-muted">{task.overdue?"Overdue":"High priority"} · Due {when(task.due_at)}</span></span></a></li>;})}</ul></section>:null}
      <section aria-labelledby="home-work-heading"><div className="mb-3 flex items-end justify-between gap-3"><div className="min-w-0"><h2 className="text-lg font-semibold" id="home-work-heading">Your work</h2><p className="mt-0.5 text-sm text-task-text-muted lg:hidden">Swipe or tap a type to switch.</p></div></div><HomeWorkCards data={data} onNavigate={onNavigate}/></section>
      {team?<HomeTeamSection onNavigate={onNavigate} team={team}/>:null}
    </div></div>
  </section>;
}
function HeroStat({label,value}:{label:string;value:number}){return <div className="min-w-0 px-1 text-center"><p className="text-[1.65rem] font-semibold leading-tight tracking-tight tabular-nums text-white">{value}</p><p className="truncate text-[11px] font-medium uppercase tracking-[0.14em] text-champagne/60">{label}</p></div>}
