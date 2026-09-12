import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION_CONTROLS, builtinAccessContext, type AccessContext, type SectionControls, type UserRole } from "@jewelos/core";
import {
  COMPACT_DOCK_PATHS,
  accessibleMenu,
  buildLauncherItems,
  isTaskPath,
  navigatePath,
  pageDecision,
  pathForTopLevelRoute,
  resolveNativeDestination,
  themeToggleLabel,
  type ShellAccess,
} from "./shellModel";

const accessFor = (role: UserRole): AccessContext => builtinAccessContext({ id: `profile-${role}`, user_role: role });
const shellFor = (role: UserRole, controls: SectionControls = DEFAULT_SECTION_CONTROLS): ShellAccess => ({ access: accessFor(role), controls });
const withSectionOff = (page: keyof SectionControls["section_availability"]): SectionControls => ({
  ...DEFAULT_SECTION_CONTROLS,
  section_availability: { ...DEFAULT_SECTION_CONTROLS.section_availability, [page]: false },
});
const recorder = () => {
  const calls: string[] = [];
  return {
    calls,
    handlers: {
      navigateSection: (page: string) => calls.push(`section:${page}`),
      navigateTab: (route: string) => calls.push(`tab:${route}`),
      setPath: (path: string) => calls.push(`path:${path}`),
    },
  };
};

it("keeps only Home and Tasks in the compact dock", () => {
  expect(COMPACT_DOCK_PATHS).toEqual(["/", "/tasks"]);
});

describe("navigatePath", () => {
  it("sends a bottom-navigation task press to the supplied tab navigator", () => {
    const { calls, handlers } = recorder();
    expect(navigatePath("/tasks", shellFor("staff"), handlers)).toBe(true);
    expect(calls).toEqual(["path:/tasks", "tab:Tasks"]);
  });

  it("does not navigate to a permission-denied destination", () => {
    const { calls, handlers } = recorder();
    expect(navigatePath("/crm", shellFor("housekeeping"), handlers)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("follows a granted permission rather than the base role", () => {
    const base = accessFor("housekeeping");
    const granted: AccessContext = { ...base, permissions: { ...base.permissions, "crm.view": true } };
    const { calls, handlers } = recorder();
    expect(navigatePath("/crm", { access: granted, controls: DEFAULT_SECTION_CONTROLS }, handlers)).toBe(true);
    expect(calls).toEqual(["path:/crm", "tab:Crm"]);
  });

  it("still opens a Developer Mode-disabled section, onto its maintenance notice", () => {
    const shell = shellFor("staff", withSectionOff("reports"));
    expect(pageDecision(shell, "reports")).toBe("disabled");
    const { calls, handlers } = recorder();
    expect(navigatePath("/reports", shell, handlers)).toBe(true);
    expect(calls).toEqual(["path:/reports", "section:reports"]);
  });

  it("lets a Developer Mode manager use a disabled section", () => {
    expect(pageDecision(shellFor("super_admin", withSectionOff("reports")), "reports")).toBe("allowed");
  });
});

describe("resolveNativeDestination", () => {
  it.each([
    ["/", "Home"],
    ["/tasks", "Tasks"],
    ["/tasks/checklist", "Tasks"],
    ["/tasks/delegation", "Tasks"],
    ["/tasks/import", "Tasks"],
    ["/tasks/assigning-left", "Tasks"],
    ["/fms", "Fms"],
    ["/tasks/fms", "Fms"],
    ["/crm", "Crm"],
  ] as const)("maps %s to the implemented %s tab", (path, route) => {
    expect(resolveNativeDestination(path)).toEqual({ kind: "tab", route });
  });

  it("routes an authorized feature path through the section stack", () => {
    expect(resolveNativeDestination("/settings")).toEqual({ kind: "section", page: "settings" });
  });

  it("rejects unknown paths", () => {
    expect(resolveNativeDestination("/not-a-jewelos-page")).toBeNull();
  });
});

it("selects Tasks for every approved task workspace path", () => {
  expect(isTaskPath("/tasks")).toBe(true);
  expect(isTaskPath("/tasks/import")).toBe(true);
  expect(isTaskPath("/task-templates")).toBe(false);
});

describe("buildLauncherItems", () => {
  it("keeps the approved web launcher order and descriptions", () => {
    const items = buildLauncherItems(shellFor("staff"));
    expect(items.map((item) => item.id)).toEqual([
      "home",
      "dashboard",
      "fms_builder",
      "availability",
      "reports",
      "settings",
    ]);
    expect(items.every((item) => item.description.length > 0)).toBe(true);
  });

  it("does not expose pages the user may not open", () => {
    expect(buildLauncherItems(shellFor("housekeeping")).some((item) => item.id === "crm")).toBe(false);
  });

  it("hides a disabled section from everyone but Developer Mode managers", () => {
    expect(buildLauncherItems(shellFor("staff", withSectionOff("reports"))).some((item) => item.id === "reports")).toBe(false);
    expect(accessibleMenu(shellFor("super_admin", withSectionOff("reports"))).some((item) => item.id === "reports")).toBe(true);
  });
});

it("uses the approved web paths for visible native tabs", () => {
  expect(pathForTopLevelRoute("Home")).toBe("/");
  expect(pathForTopLevelRoute("Tasks")).toBe("/tasks");
  expect(pathForTopLevelRoute("Fms")).toBe("/fms");
  expect(pathForTopLevelRoute("Crm")).toBe("/crm");
});

it("describes the theme the toggle will activate", () => {
  expect(themeToggleLabel("light")).toBe("Switch to dark mode");
  expect(themeToggleLabel("dark")).toBe("Switch to light mode");
});
