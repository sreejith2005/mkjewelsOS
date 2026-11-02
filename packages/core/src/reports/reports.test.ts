import { describe, expect, it } from "vitest";
import { businessCsvCell, businessExportHeader, businessReports, canExportReport, crmReportFilters, jewelosReportFilters, REPORT_CATEGORIES, REPORT_STATUS_OPTIONS, reportDisplayName, reportStatusOptions, reportVariants, csvCell, encodeCsv, escapeSpreadsheetFormula, filtersToSearchParams, parseReportFilters, REPORT_CATALOG, reportFor, reportsForRole, safeExportFilename } from "./index";

describe("report catalog",()=>{
  it("contains unique report keys",()=>expect(new Set(REPORT_CATALOG.map((item)=>item.key)).size).toBe(REPORT_CATALOG.length));
  it("offers the business report catalogue in three categories",()=>{
    const all=()=>true;
    const names=businessReports("super_admin",all).map((item)=>item.name);
    expect(new Set(names)).toEqual(new Set(["Customer Master Database","Customer 360° Journey","Leads and Enquiries","CRM Follow-ups","Lead Source and Conversion","All Form Submissions","FMS Workflow Journey","FMS Stage Performance","Pending and Completed Tasks","Employee Task Performance","CRM Performance","Salesperson Performance","Employee Availability"]));
    expect(REPORT_CATEGORIES.map((item)=>item.name)).toEqual(["Customer & CRM","Forms, FMS & Tasks","Employee Performance"]);
    for(const item of businessReports("super_admin",all))expect(REPORT_CATEGORIES.map((category)=>category.id)).toContain(item.category);
  });
  it("keeps technical and earlier reports out of the business list",()=>{
    const keys=businessReports("super_admin",()=>true).map((item)=>item.key);
    for(const key of ["notification_delivery_health","export_history","task_operations","fms_sla","form_submissions_reviews","people_task_performance"])expect(keys).not.toContain(key);
    expect(reportFor("task_operations")?.category).toBe("legacy");
  });
  it("shows CRM reports only with CRM access and people reports only to people managers",()=>{
    expect(businessReports("manager",()=>false).some((item)=>item.source==="crm")).toBe(false);
    expect(businessReports("manager",(key)=>key==="crm.view").some((item)=>item.key==="customer_report_master")).toBe(true);
    expect(businessReports("staff",()=>true).some((item)=>item.key==="employee_task_performance")).toBe(false);
    expect(businessReports("hr",()=>true).some((item)=>item.key==="form_answers")).toBe(false);
  });
  it("groups the FMS journey's two modes and names every export",()=>{
    expect(reportVariants(reportFor("fms_workflow_summary")!).map((item)=>item.variantLabel)).toEqual(["Workflow summary","Stage-wise detail"]);
    expect(reportDisplayName("fms_stage_visits")).toBe("FMS Workflow Journey · Stage-wise detail");
    expect(reportDisplayName("customer_master")).toContain("earlier format");
  });
  it("hides the old CRM reports from every role since the CRM cutover and keeps housekeeping in own operational reports",()=>{for(const role of ["super_admin","admin","manager","crm","hr"] as const)expect(reportsForRole(role).some((item)=>item.key.startsWith("crm_"))).toBe(false);expect(reportFor("crm_walkins")).toBeUndefined();expect(reportsForRole("crm").length).toBeGreaterThan(0);expect(reportsForRole("housekeeping").map((item)=>item.key)).toContain("task_operations");});
  it("allows exports only when report and role allow it",()=>{expect(canExportReport("crm","task_operations")).toBe(true);expect(canExportReport("crm","crm_followups")).toBe(false);expect(canExportReport("hr","task_operations")).toBe(false);expect(canExportReport("admin","export_history")).toBe(false);});
  it("keeps contacts, answers and paths out of the earlier reports",()=>expect(REPORT_CATALOG.filter((item)=>item.category==="legacy"||item.category==="admin").flatMap((item)=>item.columns).some((column)=>/phone|email|answer|document|path/i.test(column.key))).toBe(false));
  it("marks business phone and answer columns as sensitive, phones as text, and has no path columns",()=>{
    const columns=REPORT_CATALOG.flatMap((item)=>item.columns);
    for(const column of columns.filter((item)=>/phone/.test(item.key)))expect(column).toMatchObject({format:"phone",sensitive:true});
    for(const column of columns.filter((item)=>/answers|details/.test(item.key)))expect(column.sensitive).toBe(true);
    expect(columns.some((column)=>/path|document|email/.test(column.key))).toBe(false);
  });
  it("explains the counts of every performance and conversion report",()=>{
    for(const key of ["employee_task_performance","customer_report_crm_staff","customer_report_sales","customer_report_sources"])expect(reportFor(key)?.notes?.length).toBeGreaterThan(1);
  });
});

describe("report filters",()=>{
  const definition=reportFor("task_operations")!;
  it("parses URL filters and round trips them",()=>{const parsed=parseReportFilters(new URLSearchParams("from=2026-08-01&to=2026-08-10&page=2&page_size=50"),definition);expect(parsed.page).toBe(2);expect(filtersToSearchParams(definition.key,parsed).get("from")).toBe("2026-08-01");});
  it("reads the business filters and rejects invalid ones",()=>{
    const forms=reportFor("form_answers")!;
    expect(parseReportFilters({form_family_id:"8f6b1c1e-2f0a-4c1e-9a55-5b1f1d2c3e4f",search:" ring "},forms)).toMatchObject({form_family_id:"8f6b1c1e-2f0a-4c1e-9a55-5b1f1d2c3e4f",search:"ring"});
    expect(()=>parseReportFilters({form_family_id:"nope"},forms)).toThrow();
    expect(()=>parseReportFilters({work_kind:"other"},reportFor("work_register")!)).toThrow();
    expect(()=>parseReportFilters({purchase_class:"Rich"},reportFor("customer_report_master")!)).toThrow();
    expect(()=>parseReportFilters({stage_key:"bad key!"},reportFor("fms_stage_visits")!)).toThrow();
  });
  it("sends a chosen range as a custom range and maps CRM filter names",()=>{
    expect(jewelosReportFilters({from:"2026-10-01",to:"2026-10-31",page:1,page_size:25})).toEqual({from:"2026-10-01",to:"2026-10-31",preset:"custom",page:1,page_size:25});
    expect(crmReportFilters({from:"2026-10-01",to:"2026-10-31",crm_branch_id:"b",crm_employee_id:"e",purchase_class:"Buyer",client_id:"c",page:1,page_size:25})).toEqual({from:"2026-10-01",to:"2026-10-31",branchId:"b",employeeId:"e",purchaseClass:"Buyer",clientId:"c"});
  });
  it("rejects invalid keys, UUIDs, sizes, statuses, and excessive ranges",()=>{expect(()=>parseReportFilters({branch_id:"bad"},definition)).toThrow();expect(()=>parseReportFilters({page_size:"500"},definition)).toThrow();expect(()=>parseReportFilters({status:"bad value"},definition)).toThrow();expect(()=>parseReportFilters({from:"2025-01-01",to:"2026-08-10"},definition)).toThrow();});
});

describe("safe CSV",()=>{
  it.each(["=1+1","+SUM(A1)","-2+3","@cmd"])("escapes formula prefix %s",(value)=>expect(escapeSpreadsheetFormula(value)).toBe(`'${value}`));
  it("quotes commas, quotes, CRLF, and newlines",()=>{expect(csvCell("a,b")).toBe('"a,b"');expect(csvCell('a"b')).toBe('"a""b"');expect(csvCell("a\nb")).toBe('"a\nb"');});
  it("emits UTF-8 BOM and CRLF rows",()=>expect(encodeCsv(["name","value"],[{name:"Synthetic",value:"=1"}])).toBe("﻿name,value\r\nSynthetic,'=1\r\n"));
  it("exports phones as text and times in IST without opening a formula hole",()=>{
    expect(businessCsvCell("+91 9876543210",{key:"p",label:"Phone",format:"phone"})).toBe(`"=""+91 9876543210"""`);
    expect(businessCsvCell("=HYPERLINK(1)",{key:"p",label:"Phone",format:"phone"})).toBe("'=HYPERLINK(1)");
    expect(businessCsvCell("2026-11-01T18:45:00Z",{key:"t",label:"Created",format:"instant"})).toBe("2026-11-02 00:15");
    expect(businessCsvCell(true,{key:"b",label:"Overdue",format:"boolean"})).toBe("Yes");
    expect(businessCsvCell("do_not_contact",{key:"s",label:"Outcome",format:"status"})).toBe("Do not contact");
    expect(businessCsvCell("2026-11-03",{key:"d",label:"Due",format:"date"})).toBe("2026-11-03");
    expect(businessExportHeader({key:"t",label:"Created",format:"instant"})).toBe("Created (IST)");
  });
  it("creates bounded safe filenames",()=>expect(safeExportFilename("CRM Followups / Unsafe",new Date("2026-08-10T00:00:00Z"))).toBe("crm-followups-unsafe-2026-08-10.csv"));
});

describe("report status options",()=>{
  it("covers only catalog reports that filter on status, with valid filter values",()=>{
    for(const [key,values] of Object.entries(REPORT_STATUS_OPTIONS)){
      expect(reportFor(key)?.filters).toContain("status");
      for(const value of values)expect(value).toMatch(/^[a-z_]{1,40}$/);
    }
    expect(reportStatusOptions("task_operations")).toContain("overdue");
    expect(reportStatusOptions("notification_delivery_health")).toBeNull();
  });
});
