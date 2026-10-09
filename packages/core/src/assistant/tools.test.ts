import { describe, expect, it } from "vitest";
import { builtinAccessContext, type AccessContext } from "../permissions/resolve";
import { DEFAULT_SECTION_CONTROLS, type SectionControls } from "../settings/sectionAvailability";
import { IMPLEMENTED_PAGE_IDS, type PageId, type UserRole } from "../roleMenu";
import {
  KIARA_TOOLS,
  KIARA_TOOL_NAMES,
  accessibleKiaraSections,
  getKiaraTool,
  offeredKiaraTools,
  validateKiaraToolInput,
} from "./tools";

const accessFor = (role: UserRole, overrides: Partial<Record<string, boolean>> = {}): AccessContext => {
  const base = builtinAccessContext({ id: `${role}-profile`, user_role: role });
  return { ...base, permissions: { ...base.permissions, ...overrides } as AccessContext["permissions"] };
};
const withSectionOff = (page: PageId): SectionControls => ({
  ...DEFAULT_SECTION_CONTROLS,
  section_availability: { ...DEFAULT_SECTION_CONTROLS.section_availability, [page]: false },
});
const names = (access: AccessContext, controls: SectionControls = DEFAULT_SECTION_CONTROLS) =>
  offeredKiaraTools(access, controls).map((tool) => tool.definition.name);

describe("tool offering", () => {
  const STAFF = ["get_my_work_summary", "get_app_help", "search_my_tasks", "get_fms_work", "get_my_notifications", "search_forms", "get_leave", "get_availability", "get_dashboard_metrics", "list_reports", "run_report", "find_colleague"];
  const MANAGER = ["get_my_work_summary", "get_app_help", "search_my_tasks", "get_fms_work", "get_my_notifications", "search_forms", "get_leave", "get_availability", "get_dashboard_metrics", "get_team_progress", "list_reports", "run_report", "find_people", "find_colleague"];

  it("offers staff only their own-work tools, the scoped Dashboard and Reports, and the directory", () => {
    expect(names(accessFor("staff"))).toEqual(STAFF);
    expect(names(accessFor("staff"))).not.toContain("get_team_progress");
    expect(names(accessFor("staff"))).not.toContain("find_people");
  });

  it.each(["manager", "admin", "super_admin"] as const)("offers %s every Phase 2 tool", (role) => {
    expect(names(accessFor(role))).toEqual(MANAGER);
  });

  it("offers HR no forms tool (no Forms access by default) and FMS work through Tasks", () => {
    expect(names(accessFor("hr"))).toContain("get_fms_work");
    expect(names(accessFor("hr"))).not.toContain("search_forms");
    expect(names(accessFor("hr"))).toContain("get_team_progress");
  });

  it("follows individual grants and denies", () => {
    expect(names(accessFor("staff", { "task_control.view": true }))).toContain("get_team_progress");
    expect(names(accessFor("manager", { "users.view": false }))).not.toContain("find_people");
    expect(names(accessFor("staff", { "reports.view": false }))).not.toContain("run_report");
  });

  it("offers FMS work through either FMS or Tasks access", () => {
    expect(names(accessFor("staff", { "fms.view": false }))).toContain("get_fms_work");
    expect(names(accessFor("staff", { "tasks.view": false }))).toContain("get_fms_work");
    expect(names(accessFor("staff", { "tasks.view": false, "fms.view": false }))).not.toContain("get_fms_work");
  });

  it("offers nothing when Ask Kiara is denied to the user", () => {
    expect(names(accessFor("staff", { "assistant.view": false }))).toEqual([]);
  });

  it("offers nothing to staff while the section is dark, but everything to Super Admin", () => {
    expect(names(accessFor("staff"), withSectionOff("ask_kiara"))).toEqual([]);
    expect(names(accessFor("super_admin"), withSectionOff("ask_kiara"))).toEqual(MANAGER);
  });

  it("withholds the work summary without Home access or while Home is disabled", () => {
    expect(names(accessFor("staff", { "home.view": false }))).toEqual(STAFF.filter((name) => name !== "get_my_work_summary"));
    expect(names(accessFor("staff"), withSectionOff("home"))).toEqual(STAFF.filter((name) => name !== "get_my_work_summary"));
    expect(names(accessFor("staff"), withSectionOff("reports"))).not.toContain("run_report");
  });

  it("keeps catalogue order and identical bytes for one permission shape (prompt caching)", () => {
    const first = JSON.stringify(offeredKiaraTools(accessFor("staff"), DEFAULT_SECTION_CONTROLS).map((tool) => tool.definition));
    const second = JSON.stringify(offeredKiaraTools({ ...accessFor("staff"), profileId: "another-staff" }, DEFAULT_SECTION_CONTROLS).map((tool) => tool.definition));
    expect(second).toBe(first);
    expect(KIARA_TOOLS.map((tool) => tool.definition.name)).toEqual([...KIARA_TOOL_NAMES]);
  });

  it("declares strict schemas with no additional properties and a fixed status label", () => {
    for (const tool of KIARA_TOOLS) {
      expect(tool.definition.strict).toBe(true);
      expect(tool.definition.input_schema.additionalProperties).toBe(false);
      expect(tool.definition.input_schema.required.every((key) => key in tool.definition.input_schema.properties)).toBe(true);
      expect(tool.statusLabel.length).toBeGreaterThan(0);
      expect(getKiaraTool(tool.definition.name)).toBe(tool);
    }
  });
});

describe("accessible help sections", () => {
  it("follows section permissions", () => {
    const staff = accessibleKiaraSections(accessFor("staff"), DEFAULT_SECTION_CONTROLS);
    expect(staff).toContain("ask_kiara");
    expect(staff).not.toContain("users");
    expect(staff).not.toContain("dropdown_master");
    expect(accessibleKiaraSections(accessFor("super_admin"), DEFAULT_SECTION_CONTROLS)).toEqual(IMPLEMENTED_PAGE_IDS);
  });

  it("drops a disabled section except for Developer Mode managers", () => {
    expect(accessibleKiaraSections(accessFor("staff"), withSectionOff("reports"))).not.toContain("reports");
    expect(accessibleKiaraSections(accessFor("super_admin"), withSectionOff("reports"))).toContain("reports");
  });
});

describe("tool input validation", () => {
  it("accepts the work summary only with an empty input", () => {
    expect(validateKiaraToolInput("get_my_work_summary", {})).toEqual({ ok: true, input: { name: "get_my_work_summary" } });
    expect(validateKiaraToolInput("get_my_work_summary", { user_id: "someone-else" })).toEqual({ ok: false, error: "Unknown field: user_id" });
    expect(validateKiaraToolInput("get_my_work_summary", null).ok).toBe(false);
  });

  it("checks the help section and trims the question", () => {
    expect(validateKiaraToolInput("get_app_help", { section: "availability", question: "  How do I apply for leave?  " }))
      .toEqual({ ok: true, input: { name: "get_app_help", section: "availability", question: "How do I apply for leave?" } });
    expect(validateKiaraToolInput("get_app_help", { section: "secret_admin", question: "x" }).ok).toBe(false);
    expect(validateKiaraToolInput("get_app_help", { section: "home", question: "" }).ok).toBe(false);
    const long = validateKiaraToolInput("get_app_help", { section: "home", question: "a".repeat(500) });
    expect(long.ok && long.input.name === "get_app_help" ? long.input.question.length : 0).toBe(200);
  });

  it("validates Phase 2 inputs: enums, dates, integers, text, required fields", () => {
    expect(validateKiaraToolInput("search_my_tasks", { status: "overdue", period: "this_week", limit: 50 }))
      .toEqual({ ok: true, input: { name: "search_my_tasks", status: "overdue", period: "this_week", limit: 20 } });
    expect(validateKiaraToolInput("search_my_tasks", { status: "late" }).ok).toBe(false);
    expect(validateKiaraToolInput("search_my_tasks", { from: "9 Oct" }).ok).toBe(false);
    expect(validateKiaraToolInput("search_my_tasks", { limit: 2.5 }).ok).toBe(false);
    expect(validateKiaraToolInput("search_my_tasks", { text: "   " })).toEqual({ ok: true, input: { name: "search_my_tasks" } });
    expect(validateKiaraToolInput("get_leave", {})).toEqual({ ok: false, error: "scope is required." });
    expect(validateKiaraToolInput("get_leave", { scope: "office", user_id: "x" })).toEqual({ ok: false, error: "Unknown field: user_id" });
    expect(validateKiaraToolInput("run_report", { report_key: "export_history" }).ok).toBe(false);
    expect(validateKiaraToolInput("run_report", { report_key: "task_operations", page: 9 })).toEqual({ ok: true, input: { name: "run_report", report_key: "task_operations", page: 5 } });
    expect(validateKiaraToolInput("find_colleague", { person_name: "x".repeat(200) })).toEqual({ ok: true, input: { name: "find_colleague", person_name: "x".repeat(60) } });
    expect(validateKiaraToolInput("get_my_notifications", { unread_only: "yes" }).ok).toBe(false);
  });

  it("never lets a tool input name another user", () => {
    for (const spec of KIARA_TOOLS) {
      const keys = Object.keys(spec.definition.input_schema.properties);
      expect(keys.some((key) => /(_id|user|profile|tenant)$/.test(key))).toBe(false);
    }
  });

  it("keeps descriptions short and free of volatile text", () => {
    for (const spec of KIARA_TOOLS) {
      expect(spec.definition.description.length).toBeLessThanOrEqual(520);
      expect(spec.definition.description).not.toMatch(/20\d\d/);
    }
  });

  it("rejects unknown tools", () => {
    expect(validateKiaraToolInput("run_sql", {})).toEqual({ ok: false, error: "Unknown tool: run_sql" });
  });
});
