import { describe, expect, it, vi } from "vitest";
import { canAccessPage, deriveCrmCapability, normalizeCrmSearch, validateWalkinConditional } from "@jewelos/core";
import { createSubmissionGuard, finalizePrivateUpload, groupFollowups, mapTimeline, mergeConfirmation, staleEditMessage, validateCrmDocumentFile } from "./viewModel";

describe("CRM route and role-aware actions",()=>{
 it.each(["super_admin","admin","manager","crm"] as const)("allows %s route",(role)=>expect(canAccessPage(role,"crm")).toBe(true));
 it.each(["staff","doer","hr","housekeeping"] as const)("denies %s route",(role)=>expect(canAccessPage(role,"crm")).toBe(false));
 it("shows merge only to administrators",()=>{expect(deriveCrmCapability({role:"admin",active:true}).canMergeClients).toBe(true);expect(deriveCrmCapability({role:"manager",active:true,sameBranch:true}).canMergeClients).toBe(false);});
 it("restricts CRM edit action to assigned branch client",()=>{expect(deriveCrmCapability({role:"crm",active:true,sameBranch:true,assigned:true}).canEditClient).toBe(true);expect(deriveCrmCapability({role:"crm",active:true,sameBranch:true,assigned:false}).canEditClient).toBe(false);});
});

describe("bounded search and phone-first walk-in state",()=>{
 it("caps directory pages",()=>expect(normalizeCrmSearch({query:"Synthetic",limit:1000}).limit).toBe(100));
 it("canonicalizes a phone-first lookup",()=>expect(normalizeCrmSearch({query:"+91 98765 43210"}).query).toBe("+919876543210"));
 it("shows conditional not-bought validation",()=>expect(validateWalkinConditional({productBought:false,buyStatus:"not_bought"})).toContain("Not-bought reason is required for this outcome."));
 it("shows conditional follow-up validation",()=>expect(validateWalkinConditional({productBought:false,buyStatus:"considering"})).toContain("A follow-up date is required for this outcome."));
 it("prevents double submission while a request is pending",async()=>{const guard=createSubmissionGuard();let release!:()=>void;const pending=new Promise<void>((resolve)=>{release=resolve;});const action=vi.fn(()=>pending);const first=guard(action);const second=await guard(action);expect(second).toBeUndefined();expect(action).toHaveBeenCalledTimes(1);release();await first;});
});

describe("timeline, follow-up, stale edit, and merge presentation",()=>{
 it("renders newest timeline first with display mapping",()=>{const mapped=mapTimeline([{id:"a",event_type:"call",subject:null,outcome:null,summary:null,occurred_at:"2026-08-09T10:00:00Z",created_by:null,ref_id:null},{id:"b",event_type:"walkin",subject:null,outcome:null,summary:null,occurred_at:"2026-08-10T10:00:00Z",created_by:null,ref_id:null}]);expect(mapped.map((item)=>item.id)).toEqual(["b","a"]);expect(mapped[0]?.label).toBe("Walk-in recorded");});
 it("groups follow-up queues for Today, Overdue, Upcoming, and Completed",()=>{const grouped=groupFollowups([{id:"1",client_id:"c",assigned_to:null,branch_id:null,due_date:"2026-08-10",status:"open",subject:null,outcome:null,cancel_reason:null,record_version:1},{id:"2",client_id:"c",assigned_to:null,branch_id:null,due_date:"2026-08-09",status:"open",subject:null,outcome:null,cancel_reason:null,record_version:1},{id:"3",client_id:"c",assigned_to:null,branch_id:null,due_date:"2026-08-11",status:"open",subject:null,outcome:null,cancel_reason:null,record_version:1},{id:"4",client_id:"c",assigned_to:null,branch_id:null,due_date:"2026-08-01",status:"completed",subject:null,outcome:null,cancel_reason:null,record_version:1}],new Date("2026-08-09T18:45:00Z"));expect(Object.fromEntries(Object.entries(grouped).map(([key,value])=>[key,value.length]))).toMatchObject({today:1,overdue:1,upcoming:1,completed:1});});
 it("translates stale edit errors into recovery guidance",()=>expect(staleEditMessage(new Error("Client changed since it was opened"))).toContain("Refresh"));
 it("requires explicit distinct survivor confirmation",()=>{expect(mergeConfirmation("survivor","duplicate","MERGE")).toBe(true);expect(mergeConfirmation("same","same","MERGE")).toBe(false);expect(mergeConfirmation("survivor","duplicate","yes")).toBe(false);});
});

describe("private document lifecycle",()=>{
 it("accepts only permitted extension, MIME, and size combinations",()=>{expect(validateCrmDocumentFile({name:"synthetic.pdf",type:"application/pdf",size:1024})).toBeNull();expect(validateCrmDocumentFile({name:"synthetic.exe",type:"application/octet-stream",size:1024})).toContain("JPG");expect(validateCrmDocumentFile({name:"synthetic.pdf",type:"application/pdf",size:10*1024*1024+1})).toContain("10 MB");});
 it("cleans up an uploaded object when metadata registration fails",async()=>{const registrationError=new Error("Synthetic registration failure");const cleanup=vi.fn(async()=>undefined);await expect(finalizePrivateUpload(async()=>{throw registrationError;},cleanup)).rejects.toBe(registrationError);expect(cleanup).toHaveBeenCalledTimes(1);});
});
