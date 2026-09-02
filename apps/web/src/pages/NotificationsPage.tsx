import { useCallback, useEffect, useState } from "react";
import { Bell, FileText, History, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { useAuth } from "@/auth/AuthContext";
import { DeliveryLogs } from "@/features/notifications/DeliveryLogs";
import { NotificationInbox } from "@/features/notifications/NotificationInbox";
import { ProviderStatus } from "@/features/notifications/ProviderStatus";
import { RuleManager } from "@/features/notifications/RuleBuilder";
import { TemplateManager } from "@/features/notifications/TemplateEditor";
import { loadActiveRecipientProfiles, loadInbox, loadProviders, loadRules, loadTemplates, subscribeToInbox } from "@/features/notifications/api";
import type { InboxNotification, NotificationRuleRow, NotificationTemplateRow, ProviderAvailability } from "@/features/notifications/types";

type Tab = "inbox" | "templates" | "rules" | "logs";

export function NotificationsPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { profile } = useAuth();
  const isAdmin = profile?.user_role === "super_admin" || profile?.user_role === "admin";
  const [tab,setTab]=useState<Tab>("inbox"); const [items,setItems]=useState<InboxNotification[]>([]); const [templates,setTemplates]=useState<NotificationTemplateRow[]>([]); const [rules,setRules]=useState<NotificationRuleRow[]>([]); const [providers,setProviders]=useState<ProviderAvailability[]>([]); const [profiles,setProfiles]=useState<Array<{id:string;employee_name:string;user_role:string}>>([]); const [loading,setLoading]=useState(true); const [error,setError]=useState<string|null>(null); const [adminError,setAdminError]=useState<string|null>(null);
  const refreshInbox=useCallback(async()=>{if(!profile)return;setError(null);try{setItems(await loadInbox(profile.id));}catch(caught){setError(caught instanceof Error?caught.message:"Notifications could not be loaded");}},[profile]);
  const refreshAdmin=useCallback(async()=>{if(!isAdmin)return;setAdminError(null);try{const [nextTemplates,nextRules,nextProviders,nextProfiles]=await Promise.all([loadTemplates(),loadRules(),loadProviders(),loadActiveRecipientProfiles()]);setTemplates(nextTemplates);setRules(nextRules);setProviders(nextProviders);setProfiles(nextProfiles);}catch(caught){setAdminError(caught instanceof Error?caught.message:"Notification administration could not be loaded");}},[isAdmin]);
  const refreshAll=useCallback(async()=>{setLoading(true);setError(null);await refreshInbox();setLoading(false);},[refreshInbox]);
  useEffect(()=>{void refreshAll();},[refreshAll]);
  useEffect(()=>{if(isAdmin&&tab!=="inbox")void refreshAdmin();},[isAdmin,refreshAdmin,tab]);
  useEffect(()=>profile?subscribeToInbox(profile.id,()=>{void refreshInbox();}):undefined,[profile,refreshInbox]);
  if(!profile)return null;
  const tabs:Array<{id:Tab;label:string;Icon:typeof Bell;admin?:boolean}>=[{id:"inbox",label:"Inbox",Icon:Bell},{id:"templates",label:"Templates",Icon:FileText,admin:true},{id:"rules",label:"Rules",Icon:Settings,admin:true},{id:"logs",label:"Delivery logs",Icon:History,admin:true}];
  return <div className="space-y-5"><header className="rounded-2xl border border-task-border bg-task-bg p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2"><Bell className="size-6 text-task-accent"/><h1 className="text-2xl font-bold text-task-text">Notifications</h1></div><p className="mt-1 text-sm text-task-text-muted">Inbox, reviewed rules, safe templates, and privacy-safe delivery history.</p></div><Button onClick={()=>void refreshAll()} variant="secondary"><RefreshCw className="size-4"/> Refresh</Button></div>{isAdmin&&!loading?<div className="mt-5"><ProviderStatus providers={providers}/></div>:null}</header>{error?<Notice tone="danger">{error}</Notice>:null}{adminError?<Notice tone="danger">Notification administration: {adminError}</Notice>:null}<nav aria-label="Notification sections" className="scroll-x no-scrollbar flex gap-2 rounded-xl border border-task-border bg-task-bg p-2">{tabs.filter((item)=>!item.admin||isAdmin).map(({id,label,Icon})=><button aria-current={tab===id?"page":undefined} className={tab===id?"flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-task-accent px-4 text-sm font-semibold text-white":"flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold text-task-text-muted hover:bg-task-muted hover:text-task-text"} key={id} onClick={()=>setTab(id)} type="button"><Icon className="size-4"/>{label}</button>)}</nav>{!isAdmin&&tab!=="inbox"?<Notice tone="danger">Only administrators can manage notification rules, templates, providers, and delivery logs.</Notice>:tab==="inbox"?<NotificationInbox error={error} items={items} loading={loading} onNavigate={onNavigate} onRefresh={refreshInbox}/>:tab==="templates"?<TemplateManager onRefresh={refreshAdmin} providers={providers} templates={templates}/>:tab==="rules"?<RuleManager onRefresh={refreshAdmin} profiles={profiles} providers={providers} rules={rules} templates={templates}/>:tab==="logs"?<DeliveryLogs/>:<Notice tone="task"><ShieldCheck className="mr-2 inline size-4"/>This administration surface is protected by Postgres RPC authorization.</Notice>}</div>;
}
