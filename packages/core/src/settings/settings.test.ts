import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION_CONTROLS, DEFAULT_USER_PREFERENCES, canBypassSectionMaintenance, isSectionUnderMaintenance, validateBranchSettings, validateSectionControls, validateTenantSettings, validateUserPreferences } from "./index";

describe("settings validation",()=>{
  it("applies safe user defaults",()=>expect(validateUserPreferences({})).toEqual(DEFAULT_USER_PREFERENCES));
  it("rejects unknown preference keys and enums",()=>{expect(()=>validateUserPreferences({branch_id:"x"})).toThrow("Unknown");expect(()=>validateUserPreferences({table_density:"tiny"})).toThrow();});
  it("accepts bounded tenant settings",()=>expect(validateTenantSettings({name:"MK Jewels",currency:"INR",timezone:"Asia/Kolkata",export_retention_days:7,export_max_rows:50000})).toMatchObject({currency:"INR",export_retention_days:7}));
  it("rejects invalid timezone, retention, and row limits",()=>{expect(()=>validateTenantSettings({name:"MK",currency:"INR",timezone:"Wrong/Zone",export_retention_days:7,export_max_rows:50000})).toThrow();expect(()=>validateTenantSettings({name:"MK",currency:"INR",timezone:"UTC",export_retention_days:60,export_max_rows:50000})).toThrow();});
  it("accepts only bounded branch reporting defaults",()=>{expect(validateBranchSettings({report_default_department_id:null,export_max_rows:1000})).toEqual({report_default_department_id:null,export_max_rows:1000});expect(()=>validateBranchSettings({tenant_id:"x"})).toThrow();});
  it("defaults every section to available and validates the complete maintenance contract",()=>{expect(isSectionUnderMaintenance(DEFAULT_SECTION_CONTROLS,"crm")).toBe(false);expect(validateSectionControls(DEFAULT_SECTION_CONTROLS)).toEqual(DEFAULT_SECTION_CONTROLS);expect(()=>validateSectionControls({...DEFAULT_SECTION_CONTROLS,section_availability:{...DEFAULT_SECTION_CONTROLS.section_availability,crm:"no"}})).toThrow("Invalid section availability");});
  it("reserves maintenance bypass for Super Admins",()=>{expect(canBypassSectionMaintenance("super_admin")).toBe(true);expect(canBypassSectionMaintenance("admin")).toBe(false);expect(canBypassSectionMaintenance("manager")).toBe(false);});
});
