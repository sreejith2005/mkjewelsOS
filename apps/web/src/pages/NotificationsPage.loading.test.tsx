// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
  auth:{access:{},profile:{id:"u1",tenant_id:"t1"}},
  loadInbox:vi.fn(),loadTemplates:vi.fn(),loadRules:vi.fn(),loadProviders:vi.fn(),loadActiveRecipientProfiles:vi.fn(),loadDeliveryLogs:vi.fn(),archiveTemplate:vi.fn(),
  refresh:undefined as (()=>Promise<void>)|undefined,
}));
vi.mock("@/auth/AuthContext",()=>({useAuth:()=>mocks.auth}));
vi.mock("@jewelos/api-client",()=>({supabase:{}}));
vi.mock("@jewelos/core",async(original)=>({...await original<typeof import("@jewelos/core")>(),hasPermission:()=>true}));
vi.mock("@/features/realtime/useTenantRealtimeRefresh",()=>({useTenantRealtimeRefresh:({refresh}:{refresh:()=>Promise<void>})=>{mocks.refresh=refresh;return ()=>void mocks.refresh?.();}}));
vi.mock("@/features/notifications/api",async(original)=>({...await original<typeof import("@/features/notifications/api")>(),
  loadInbox:mocks.loadInbox,loadTemplates:mocks.loadTemplates,loadRules:mocks.loadRules,loadProviders:mocks.loadProviders,loadActiveRecipientProfiles:mocks.loadActiveRecipientProfiles,loadDeliveryLogs:mocks.loadDeliveryLogs,archiveTemplate:mocks.archiveTemplate,subscribeToInbox:()=>()=>undefined,
}));

import {NotificationsPage} from "./NotificationsPage";

const template={id:"template1",name:"Original template",event_type:"task_assigned",channel:"in_app",title_template:"Task assigned",body_template:"Please check your tasks.",link_url:null,is_active:true,lifecycle:"active"};
beforeEach(()=>{
  mocks.loadInbox.mockResolvedValue([{id:"n1",event_type:"task_assigned",title:"Your assigned task",message:"Task details",link_url:null,is_read:false,read_at:null,priority:"medium",created_at:"2026-11-05T09:00:00Z"}]);
  mocks.loadTemplates.mockResolvedValue([template]);mocks.loadRules.mockResolvedValue([]);mocks.loadActiveRecipientProfiles.mockResolvedValue([]);mocks.loadDeliveryLogs.mockResolvedValue([]);
  mocks.loadProviders.mockResolvedValue([{channel:"in_app",is_available:true,status_reason:"In-app delivery configured"}]);
});
afterEach(()=>{cleanup();vi.resetAllMocks();});

it("refreshes inbox and visible provider status without reading hidden admin lists",async()=>{
  render(<NotificationsPage onNavigate={()=>undefined}/>);
  expect(await screen.findByText("Your assigned task")).toBeTruthy();
  await act(async()=>{await mocks.refresh?.();});
  expect(await screen.findByText("In-app delivery configured")).toBeTruthy();
  expect(mocks.loadTemplates).not.toHaveBeenCalled();
  expect(mocks.loadRules).not.toHaveBeenCalled();
  expect(mocks.loadActiveRecipientProfiles).not.toHaveBeenCalled();
});

it("loads only templates and provider status for the Templates tab",async()=>{
  render(<NotificationsPage onNavigate={()=>undefined}/>);
  await screen.findByText("Your assigned task");
  fireEvent.click(screen.getByRole("button",{name:"Templates"}));
  expect(await screen.findByText("Original template")).toBeTruthy();
  expect(mocks.loadRules).not.toHaveBeenCalled();
  expect(mocks.loadActiveRecipientProfiles).not.toHaveBeenCalled();
  expect(screen.getByText("In-app delivery configured")).toBeTruthy();
});

it("refreshes template data after archive without loading rule-only dependencies",async()=>{
  render(<NotificationsPage onNavigate={()=>undefined}/>);
  await screen.findByText("Your assigned task");
  fireEvent.click(screen.getByRole("button",{name:"Templates"}));
  await screen.findByText("Original template");
  mocks.archiveTemplate.mockImplementation(async()=>{mocks.loadTemplates.mockResolvedValue([{...template,name:"Archived template",lifecycle:"archived"}]);});
  fireEvent.click(screen.getByRole("button",{name:"Archive"}));
  expect(await screen.findByText("Archived template")).toBeTruthy();
  expect(mocks.loadRules).not.toHaveBeenCalled();
  expect(mocks.loadActiveRecipientProfiles).not.toHaveBeenCalled();
});

it("loads every Rules dependency and stops reading them after returning to Inbox",async()=>{
  render(<NotificationsPage onNavigate={()=>undefined}/>);
  await screen.findByText("Your assigned task");
  fireEvent.click(screen.getByRole("button",{name:"Rules"}));
  await waitFor(()=>expect(mocks.loadActiveRecipientProfiles).toHaveBeenCalledTimes(1));
  expect(mocks.loadTemplates).toHaveBeenCalledTimes(1);
  expect(mocks.loadRules).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"Inbox"}));
  await act(async()=>{await mocks.refresh?.();});
  expect(mocks.loadTemplates).toHaveBeenCalledTimes(1);
  expect(mocks.loadRules).toHaveBeenCalledTimes(1);
  expect(mocks.loadActiveRecipientProfiles).toHaveBeenCalledTimes(1);
});

it("lets Delivery logs load its own data without fetching rule or template lists",async()=>{
  render(<NotificationsPage onNavigate={()=>undefined}/>);
  await screen.findByText("Your assigned task");
  fireEvent.click(screen.getByRole("button",{name:"Delivery logs"}));
  expect(await screen.findByText("No delivery logs match these filters.")).toBeTruthy();
  expect(mocks.loadTemplates).not.toHaveBeenCalled();
  expect(mocks.loadRules).not.toHaveBeenCalled();
  expect(mocks.loadActiveRecipientProfiles).not.toHaveBeenCalled();
});

it("does not reload a hidden Templates tab when an archive finishes after leaving it",async()=>{
  let finishArchive!:()=>void;
  mocks.archiveTemplate.mockReturnValue(new Promise<void>((resolve)=>{finishArchive=resolve;}));
  render(<NotificationsPage onNavigate={()=>undefined}/>);
  await screen.findByText("Your assigned task");
  fireEvent.click(screen.getByRole("button",{name:"Templates"}));
  await screen.findByText("Original template");
  fireEvent.click(screen.getByRole("button",{name:"Archive"}));
  fireEvent.click(screen.getByRole("button",{name:"Inbox"}));
  await act(async()=>finishArchive());
  expect(mocks.loadTemplates).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Your assigned task")).toBeTruthy();
});
