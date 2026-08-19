import { describe, expect, it, vi } from "vitest";
import type { InboxNotification, RuleDraft } from "./types";
import {
  createSubscriptionLifecycle,
  deliveryCanRetry,
  filterInbox,
  inboxDisplayState,
  isChannelSelectable,
  notificationDestination,
  notificationTabs,
  recentNotifications,
  unreadBadge,
  validateRuleDraft,
  validateTemplateDraft,
  withAllNotificationsRead,
  withNotificationRead,
} from "./viewModel";

const items: InboxNotification[] = [
  { id:"1",event_type:"task_assigned",title:"New task",message:"Count stock",link_url:"/tasks/checklist",is_read:false,read_at:null,priority:"high",created_at:"2026-08-10T10:00:00Z" },
  { id:"2",event_type:"form_approved",title:"Form approved",message:"Opening",link_url:"/forms",is_read:true,read_at:"2026-08-10T09:00:00Z",priority:"medium",created_at:"2026-08-10T09:00:00Z" },
];

describe("notification bell and inbox view model",()=>{
  it("caps bell counts at 99+",()=>expect(unreadBadge(100)).toBe("99+"));
  it("selects recent popover items",()=>expect(recentNotifications([...items].reverse(),1)[0]?.id).toBe("1"));
  it("marks one notification read and unread",()=>{expect(withNotificationRead(items,"1",true)[0]?.is_read).toBe(true);expect(withNotificationRead(items,"2",false)[1]?.is_read).toBe(false);});
  it("marks all notifications read",()=>expect(withAllNotificationsRead(items).every((item)=>item.is_read)).toBe(true));
  it("filters inbox by unread, event, priority, and search",()=>expect(filterInbox(items,{unreadOnly:true,eventType:"task_assigned",priority:"high",search:"stock"}).map((item)=>item.id)).toEqual(["1"]));
  it("allows safe internal navigation only",()=>{expect(notificationDestination("/forms?id=1")).toBe("/forms?id=1");expect(notificationDestination("https://evil.example")).toBeNull();});
  it("shows admin tabs only to administrators",()=>{expect(notificationTabs("admin")).toEqual(["inbox","templates","rules","logs"]);expect(notificationTabs("manager")).toEqual(["inbox"]);});
  it("models loading, empty, error, and ready states",()=>{expect(inboxDisplayState(true,null,0)).toBe("loading");expect(inboxDisplayState(false,"failed",0)).toBe("error");expect(inboxDisplayState(false,null,0)).toBe("empty");expect(inboxDisplayState(false,null,2)).toBe("ready");});
});

describe("notification administration view model",()=>{
  it("validates template variables and safe links",()=>{expect(validateTemplateDraft("task_assigned","Task {{task_title}}","Due {{planned_datetime}}","/tasks/checklist")).toEqual([]);expect(validateTemplateDraft("task_assigned","{{client_phone}}","Body","https://evil.example").length).toBe(2);});
  it("validates rule builder fields",()=>{const draft:RuleDraft={name:"Assigned",eventType:"task_assigned",conditions:[{field:"priority",operator:"equals",value:"high"}],recipients:[{type:"assigned_users"}],channelTemplates:{in_app:"template"},delayMinutes:0,cooldownMinutes:0,maxAttempts:3,backoffMinutes:5,priority:"high",enabled:true};expect(validateRuleDraft(draft)).toEqual([]);expect(validateRuleDraft({...draft,conditions:[{field:"phone",operator:"equals",value:"x"}]}).length).toBeGreaterThan(0);});
  it("disables unavailable channels",()=>{expect(isChannelSelectable("in_app",{in_app:true,email:false})).toBe(true);expect(isChannelSelectable("email",{in_app:true,email:false})).toBe(false);});
  it("shows retry only for eligible terminal/configuration states",()=>{expect(deliveryCanRetry("failed_terminal")).toBe(true);expect(deliveryCanRetry("blocked_configuration")).toBe(true);expect(deliveryCanRetry("delivered")).toBe(false);});
  it("cleans up one subscription",()=>{const cleanup=vi.fn();const subscribe=vi.fn(()=>cleanup);const refresh=vi.fn();const stop=createSubscriptionLifecycle(subscribe,refresh);expect(subscribe).toHaveBeenCalledOnce();stop();expect(cleanup).toHaveBeenCalledOnce();});
});
