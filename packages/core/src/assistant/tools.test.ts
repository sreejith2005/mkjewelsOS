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
  it.each(["staff", "manager", "super_admin"] as const)("offers %s the Phase 1 tools", (role) => {
    expect(names(accessFor(role))).toEqual(["get_my_work_summary", "get_app_help"]);
  });

  it("offers nothing when Ask Kiara is denied to the user", () => {
    expect(names(accessFor("staff", { "assistant.view": false }))).toEqual([]);
  });

  it("offers nothing to staff while the section is dark, but everything to Super Admin", () => {
    expect(names(accessFor("staff"), withSectionOff("ask_kiara"))).toEqual([]);
    expect(names(accessFor("super_admin"), withSectionOff("ask_kiara"))).toEqual(["get_my_work_summary", "get_app_help"]);
  });

  it("withholds the work summary without Home access or while Home is disabled", () => {
    expect(names(accessFor("staff", { "home.view": false }))).toEqual(["get_app_help"]);
    expect(names(accessFor("staff"), withSectionOff("home"))).toEqual(["get_app_help"]);
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

  it("rejects unknown tools", () => {
    expect(validateKiaraToolInput("run_sql", {})).toEqual({ ok: false, error: "Unknown tool: run_sql" });
  });
});
