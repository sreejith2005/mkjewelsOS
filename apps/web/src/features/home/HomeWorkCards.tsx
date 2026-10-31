import {ArrowRight,CheckCircle2,ChevronRight,ClipboardList,Clock3,ListChecks,Workflow,type LucideIcon} from "lucide-react";
import {useMemo,useRef,useState} from "react";
import {fmsAssignedWorkPath,fmsWorkTitle} from "@jewelos/core";
import type {HomeSummary,HomeTask} from "@/features/analytics/types";

/** get_home_summary caps each list; a full list may hide more work. */
const TASK_LIMIT=10;
const FMS_STAGE_LIMIT=6;

type Tone="overdue"|"high"|"normal";
export type WorkItem={key:string;title:string;meta:string;tags:string[];tone:Tone;path:string};
export type WorkCard={id:"checklist"|"mine"|"fms";title:string;short:string;subtitle:string;icon:LucideIcon;items:WorkItem[];capped:boolean;viewAllLabel:string;viewAllPath:string;emptyTitle:string;emptyText:string};

function dayKey(date:Date,timezone:string){return new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);}
/** "Today, 4:00 pm" / "Tomorrow, 9:30 am" / "2 Nov, 11:00 am" in the company timezone. */
export function dueLabel(value:string|null|undefined,timezone:string,now=new Date()){
  if(!value)return "No due time";
  const date=new Date(value); if(Number.isNaN(date.getTime()))return "No due time";
  const time=date.toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit",timeZone:timezone});
  const key=dayKey(date,timezone); const day=86_400_000;
  if(key===dayKey(now,timezone))return `Today, ${time}`;
  if(key===dayKey(new Date(now.getTime()+day),timezone))return `Tomorrow, ${time}`;
  if(key===dayKey(new Date(now.getTime()-day),timezone))return `Yesterday, ${time}`;
  return `${date.toLocaleDateString("en-IN",{day:"numeric",month:"short",timeZone:timezone})}, ${time}`;
}

function taskItem(task:HomeTask,timezone:string,formByTask:Map<string,string>):WorkItem{
  const form=formByTask.get(task.id);
  const tags=[task.overdue?"Overdue":null,task.priority==="high"?"High priority":null,form?`Form: ${form}`:null].filter((tag):tag is string=>!!tag);
  return {key:`task-${task.id}`,title:task.title,meta:`Due ${dueLabel(task.due_at,timezone)}`,tags,tone:task.overdue?"overdue":task.priority==="high"?"high":"normal",path:`/tasks?task_id=${encodeURIComponent(task.id)}`};
}

/** Splits the signed-in person's open work into the three Home cards. */
export function buildWorkCards(data:HomeSummary):WorkCard[]{
  const tz=data.timezone; const formByTask=new Map(data.forms_awaiting_submission.map((form)=>[form.task_id,form.form_name]));
  const tasksCapped=data.tasks.length>=TASK_LIMIT;
  const checklist=data.tasks.filter((task)=>task.task_type==="checklist");
  const fmsTasks=data.tasks.filter((task)=>task.task_type==="fms");
  const mine=data.tasks.filter((task)=>task.task_type!=="checklist"&&task.task_type!=="fms");
  const fms:WorkItem[]=[
    ...data.fms_starters.map((starter)=>({key:`starter-${starter.id}`,title:starter.flow_name,meta:`Assigned ${dueLabel(starter.assigned_at,tz)}`,tags:[`Starting form: ${starter.form_name}`],tone:"normal" as const,path:fmsAssignedWorkPath({kind:"starter_form",starterAssignmentId:starter.id,formTemplateId:starter.form_template_id})})),
    ...data.fms_stages.map((stage)=>({key:`stage-${stage.stage_id}`,title:fmsWorkTitle(stage.record_name??`${stage.instance_title} - ${stage.stage_name}`,stage.reference_number),meta:`Due ${dueLabel(stage.planned_datetime,tz)}`,tags:[stage.sla_breached?"Overdue":null,stage.form_name?`Form: ${stage.form_name}`:null].filter((tag):tag is string=>!!tag),tone:stage.sla_breached?"overdue" as const:"normal" as const,path:stage.form_template_id?fmsAssignedWorkPath({kind:"stage_form",instanceId:stage.instance_id,instanceStageId:stage.stage_id,formTemplateId:stage.form_template_id}):fmsAssignedWorkPath({kind:"stage",instanceId:stage.instance_id,instanceStageId:stage.stage_id})})),
    ...fmsTasks.map((task)=>taskItem(task,tz,formByTask)),
  ];
  return [
    {id:"checklist",title:"Daily Checklist",short:"Checklist",subtitle:"Your routine duties",icon:ListChecks,items:checklist.map((task)=>taskItem(task,tz,formByTask)),capped:tasksCapped,viewAllLabel:"Open all tasks",viewAllPath:"/tasks",emptyTitle:"Checklist clear",emptyText:"No routine duties are waiting."},
    {id:"mine",title:"My Tasks",short:"My Tasks",subtitle:"Work assigned to you",icon:ClipboardList,items:mine.map((task)=>taskItem(task,tz,formByTask)),capped:tasksCapped,viewAllLabel:"Open all tasks",viewAllPath:"/tasks",emptyTitle:"All caught up",emptyText:"No tasks are waiting on you."},
    {id:"fms",title:"FMS Tasks",short:"FMS",subtitle:"Workflow steps for you",icon:Workflow,items:fms,capped:data.fms_stages.length>=FMS_STAGE_LIMIT||tasksCapped&&fmsTasks.length>0,viewAllLabel:"Open FMS tasks",viewAllPath:"/tasks/fms",emptyTitle:"No steps waiting",emptyText:"New FMS steps for you will show here."},
  ];
}

const countLabel=(card:WorkCard)=>`${card.items.length}${card.capped&&card.items.length?"+":""}`;
const prefersReducedMotion=()=>typeof window!=="undefined"&&typeof window.matchMedia==="function"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Phones and tablets get a swipe row with a labelled switcher (one card in view,
 * the next one peeking); desktops see the three cards side by side. The page is
 * the only vertical scroll area on phones, so long lists never trap a swipe.
 */
export function HomeWorkCards({data,onNavigate}:{data:HomeSummary;onNavigate:(path:string)=>void}){
  const cards=useMemo(()=>buildWorkCards(data),[data]);
  const scroller=useRef<HTMLDivElement>(null); const frame=useRef(0);
  const [active,setActive]=useState(0);
  const cardElements=()=>Array.from(scroller.current?.children??[]) as HTMLElement[];
  const onScroll=()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{const el=scroller.current; const items=cardElements(); const first=items[0]; if(!el||!first)return; let best=0; items.forEach((item,index)=>{if(Math.abs(item.offsetLeft-first.offsetLeft-el.scrollLeft)<Math.abs((items[best]?.offsetLeft??0)-first.offsetLeft-el.scrollLeft))best=index;}); setActive(best);});};
  const show=(index:number)=>{setActive(index); const el=scroller.current; const items=cardElements(); const target=items[index]; const first=items[0]; if(el&&target&&first&&typeof el.scrollTo==="function")el.scrollTo({left:target.offsetLeft-first.offsetLeft,behavior:prefersReducedMotion()?"auto":"smooth"});};
  return <div>
    <nav aria-label="Work type" className="mb-3 grid grid-cols-3 gap-1 rounded-2xl border border-task-border bg-task-bg p-1 shadow-card lg:hidden">
      {cards.map((card,index)=>{const selected=active===index; const overdue=card.items.some((item)=>item.tone==="overdue"); return <button aria-current={selected?"true":undefined} aria-label={`Show ${card.title}, ${countLabel(card)} waiting`} className={`relative flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold transition-colors ${selected?"bg-gold/15 text-task-text ring-1 ring-gold/40 dark:text-gold-secondary":"text-task-text-muted active:bg-task-muted"}`} key={card.id} onClick={()=>show(index)} type="button"><span className="truncate">{card.short}</span><span className={`shrink-0 rounded-full px-1.5 text-[11px] leading-5 tabular-nums ${selected?"bg-gold-sheen text-on-gold":"bg-task-muted text-task-text-muted"}`}>{countLabel(card)}</span>{overdue?<span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-task-overdue"/>:null}</button>;})}
    </nav>
    <div className="no-scrollbar relative -mx-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto scroll-px-4 px-4 pb-3 pt-0.5 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:items-stretch lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0" onScroll={onScroll} ref={scroller}>
      {cards.map((card)=><WorkCardView card={card} key={card.id} onNavigate={onNavigate}/>)}
    </div>
  </div>;
}

function WorkCardView({card,onNavigate}:{card:WorkCard;onNavigate:(path:string)=>void}){
  const Icon=card.icon; const headingId=`home-card-${card.id}`; const overdue=card.items.filter((item)=>item.tone==="overdue").length;
  return <article aria-labelledby={headingId} className="flex w-[86%] min-w-0 max-w-[24rem] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-task-border bg-task-bg shadow-card sm:w-[22rem] lg:w-auto lg:max-w-none">
    <header className="flex items-center gap-3 border-b border-task-border px-4 py-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold-secondary ring-1 ring-gold/20"><Icon aria-hidden className="size-5"/></span>
      <div className="min-w-0 flex-1"><h3 className="truncate text-base font-semibold" id={headingId}>{card.title}</h3><p className="truncate text-xs text-task-text-muted">{overdue?<span className="font-semibold text-task-overdue">{overdue} overdue</span>:card.subtitle}</p></div>
      <span aria-label={`${countLabel(card)} waiting`} className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold tabular-nums ${card.items.length?"bg-gold-sheen text-on-gold shadow-gold":"bg-task-muted text-task-text-muted"}`}>{countLabel(card)}</span>
    </header>
    {card.items.length?<ul aria-label={`${card.title} waiting`} className="flex-1 divide-y divide-task-border lg:max-h-[26rem] lg:overflow-y-auto">
      {card.items.map((item)=><li key={item.key}><button className="group flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-task-muted/60 active:bg-task-muted" onClick={()=>onNavigate(item.path)} type="button">
        <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${item.tone==="overdue"?"bg-task-overdue":item.tone==="high"?"bg-task-warning":"bg-gold"}`}/>
        <span className="min-w-0 flex-1"><span className="block break-words text-[15px] font-semibold leading-snug">{item.title}</span><span className={`mt-1 flex items-center gap-1.5 text-[13px] ${item.tone==="overdue"?"text-task-overdue":"text-task-text-muted"}`}><Clock3 aria-hidden className="size-3.5 shrink-0"/><span className="truncate">{item.meta}</span></span>
          {item.tags.length?<span className="mt-2 flex flex-wrap gap-1.5">{item.tags.map((tag)=><span className={`max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-semibold ${tag==="Overdue"?"bg-task-overdue/10 text-task-overdue":tag==="High priority"?"bg-task-warning/10 text-task-warning":"bg-gold/10 text-gold-secondary"}`} key={tag}>{tag}</span>)}</span>:null}
        </span>
        <ChevronRight aria-hidden className="mt-0.5 size-5 shrink-0 text-task-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-gold-secondary"/>
      </button></li>)}
    </ul>:<div className="flex flex-1 flex-col items-center justify-center px-6 py-9 text-center"><span className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success"><CheckCircle2 aria-hidden className="size-6"/></span><p className="mt-3 text-sm font-semibold">{card.emptyTitle}</p><p className="mt-1 text-sm text-task-text-muted">{card.emptyText}</p></div>}
    <button className="group flex min-h-12 items-center justify-center gap-1.5 border-t border-task-border px-4 text-sm font-semibold text-gold-secondary transition-colors hover:bg-gold/5 active:bg-gold/10" onClick={()=>onNavigate(card.viewAllPath)} type="button">{card.viewAllLabel}<ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5"/></button>
  </article>;
}
