import { describe, expect, it } from "vitest";
import { canExportReport, csvCell, encodeCsv, escapeSpreadsheetFormula, filtersToSearchParams, parseReportFilters, REPORT_CATALOG, reportFor, reportsForRole, safeExportFilename } from "./index";

describe("fixed report catalog",()=>{
  it("contains the required unique fixed reports",()=>{expect(REPORT_CATALOG).toHaveLength(13);expect(new Set(REPORT_CATALOG.map((item)=>item.key)).size).toBe(13);});
  it("keeps HR out of CRM and housekeeping in own operational reports",()=>{expect(reportsForRole("hr").some((item)=>item.key.startsWith("crm_"))).toBe(false);expect(reportsForRole("housekeeping").map((item)=>item.key)).toContain("task_operations");});
  it("allows exports only when report and role allow it",()=>{expect(canExportReport("crm","crm_followups")).toBe(true);expect(canExportReport("hr","crm_followups")).toBe(false);expect(canExportReport("admin","export_history")).toBe(false);});
  it("contains no sensitive CRM contacts, form answers, or paths",()=>expect(REPORT_CATALOG.flatMap((item)=>item.columns).some((column)=>/phone|email|answer|document|path/i.test(column.key))).toBe(false));
});

describe("report filters",()=>{
  const definition=reportFor("task_operations")!;
  it("parses URL filters and round trips them",()=>{const parsed=parseReportFilters(new URLSearchParams("from=2026-08-01&to=2026-08-10&page=2&page_size=50"),definition);expect(parsed.page).toBe(2);expect(filtersToSearchParams(definition.key,parsed).get("from")).toBe("2026-08-01");});
  it("rejects invalid keys, UUIDs, sizes, statuses, and excessive ranges",()=>{expect(()=>parseReportFilters({branch_id:"bad"},definition)).toThrow();expect(()=>parseReportFilters({page_size:"500"},definition)).toThrow();expect(()=>parseReportFilters({status:"bad value"},definition)).toThrow();expect(()=>parseReportFilters({from:"2025-01-01",to:"2026-08-10"},definition)).toThrow();});
});

describe("safe CSV",()=>{
  it.each(["=1+1","+SUM(A1)","-2+3","@cmd"])("escapes formula prefix %s",(value)=>expect(escapeSpreadsheetFormula(value)).toBe(`'${value}`));
  it("quotes commas, quotes, CRLF, and newlines",()=>{expect(csvCell("a,b")).toBe('"a,b"');expect(csvCell('a"b')).toBe('"a""b"');expect(csvCell("a\nb")).toBe('"a\nb"');});
  it("emits UTF-8 BOM and CRLF rows",()=>expect(encodeCsv(["name","value"],[{name:"Synthetic",value:"=1"}])).toBe("\uFEFFname,value\r\nSynthetic,'=1\r\n"));
  it("creates bounded safe filenames",()=>expect(safeExportFilename("CRM Followups / Unsafe",new Date("2026-08-10T00:00:00Z"))).toBe("crm-followups-unsafe-2026-08-10.csv"));
});
