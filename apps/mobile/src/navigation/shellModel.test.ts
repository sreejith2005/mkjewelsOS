import { describe, expect, it } from "vitest";
import { ALL_MENU_ITEMS, DEFAULT_SECTION_CONTROLS, IMPLEMENTED_PAGE_IDS, builtinAccessContext, type AccessContext, type SectionControls, type UserRole } from "@jewelos/core";
import {
  COMPACT_DOCK_PATHS,
  TASKS_PRIMARY_ACTION,
  NATIVE_PENDING_PAGES,
  NATIVE_WORK_ROUTES,
  accessibleMenu,
  buildLauncherItems,
  crmTabFullScreen,
  hidesGlobalVoiceAction,
  isTaskPath,
  navigatePath,
  nativeNotificationAction,
  pageDecision,
  pathForTopLevelRoute,
  resolveNativeDestination,
  themeToggleLabel,
  type ShellAccess,
} from "./shellModel";

it("registers task creation as the Tasks workspace primary action", () => {
  expect(TASKS_PRIMARY_ACTION).toEqual({ label: "Create Task", route: "TaskComposer" });
});

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

  it("lets a staff user open assigned FMS work without FMS builder access", () => {
    const { calls, handlers } = recorder();
    // Assigned FMS work is authorized by Tasks, not by the builder section a
    // regular employee has no reason to reach.
    expect(navigatePath("/tasks/fms?instance=i-1&stage=s-1&form=f-1", shellFor("staff"), handlers)).toBe(true);
    expect(calls).toEqual(["path:/tasks/fms?instance=i-1&stage=s-1&form=f-1", "tab:Fms"]);
  });

  it("does not navigate to a permission-denied destination", () => {
    const { calls, handlers } = recorder();
    expect(navigatePath("/crm", shellFor("housekeeping"), handlers)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("opens Forms Library only for an account with forms access", () => {
    const allowed = recorder();
    expect(navigatePath("/forms", shellFor("staff"), allowed.handlers)).toBe(true);
    expect(allowed.calls).toEqual(["path:/forms", "section:forms_library"]);

    const base = accessFor("staff");
    const deniedAccess: AccessContext = { ...base, permissions: { ...base.permissions, "forms.view": false } };
    const denied = recorder();
    expect(navigatePath("/forms", { access: deniedAccess, controls: DEFAULT_SECTION_CONTROLS }, denied.handlers)).toBe(false);
    expect(denied.calls).toEqual([]);
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
    ["/tasks/in-loop", "Tasks"],
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
      "forms_library",
      "availability",
      "reports",
      "ask_kiara",
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

it("resolves every implemented web menu destination and every exact work-item target", () => {
  const implemented = new Set(IMPLEMENTED_PAGE_IDS);
  const pending = new Set(NATIVE_PENDING_PAGES);
  expect(ALL_MENU_ITEMS.filter((item) => implemented.has(item.id) && !pending.has(item.id)).every((item) => resolveNativeDestination(item.path) !== null)).toBe(true);
  expect(NATIVE_WORK_ROUTES).toEqual({ task: "TaskDetail", fmsInstance: "FmsInstance", fmsStage: "FmsStage", fmsStageForm: "FmsStageForm", formSubmission: "FormSubmission", crmClient: "Crm", notificationInbox: "Section" });
});

it("describes the theme the toggle will activate", () => {
  expect(themeToggleLabel("light")).toBe("Switch to dark mode");
  expect(themeToggleLabel("dark")).toBe("Switch to light mode");
});

describe("CRM tab (CRM Phase 6: the web CRM in a WebView)", () => {
  it("is full-screen, without the native header and dock, when the CRM section is open to the user", () => {
    expect(crmTabFullScreen(shellFor("crm"))).toBe(true);
    expect(crmTabFullScreen(shellFor("manager"))).toBe(true);
  });

  it("keeps the native shell (and its notice) when the section is disabled or the user lacks crm.view", () => {
    expect(pageDecision(shellFor("crm", withSectionOff("crm")), "crm")).toBe("disabled");
    expect(crmTabFullScreen(shellFor("crm", withSectionOff("crm")))).toBe(false);
    expect(pageDecision(shellFor("housekeeping"), "crm")).toBe("denied");
    expect(crmTabFullScreen(shellFor("housekeeping"))).toBe(false);
  });

  it("lists the CRM in the drawer only for users with crm.view and an enabled section", () => {
    expect(buildLauncherItems(shellFor("crm")).some((item) => item.id === "crm")).toBe(true);
    expect(buildLauncherItems(shellFor("housekeeping")).some((item) => item.id === "crm")).toBe(false);
    expect(buildLauncherItems(shellFor("crm", withSectionOff("crm"))).some((item) => item.id === "crm")).toBe(false);
  });

  it("opens /crm links, including Home's CRM follow-ups, on the CRM tab", () => {
    const { calls, handlers } = recorder();
    expect(navigatePath("/crm", shellFor("crm"), handlers)).toBe(true);
    expect(calls).toEqual(["path:/crm", "tab:Crm"]);
    expect(NATIVE_WORK_ROUTES.crmClient).toBe("Crm");
  });
});

describe("Ask Kiara on Android (Phase 8)", () => {
  it("has no native-pending sections left", () => {
    expect(NATIVE_PENDING_PAGES).toEqual([]);
  });

  it("lists Ask Kiara in the launcher when the section is on and the user has assistant.view", () => {
    for (const role of ["staff", "manager", "super_admin"] as const) {
      const shell = shellFor(role);
      expect(pageDecision(shell, "ask_kiara")).toBe("allowed");
      expect(buildLauncherItems(shell).some((item) => item.id === "ask_kiara")).toBe(true);
    }
  });

  it("shows no entry when the section is switched off, and refuses a direct link for a denied user", () => {
    expect(buildLauncherItems(shellFor("staff", withSectionOff("ask_kiara"))).some((item) => item.id === "ask_kiara")).toBe(false);
    const staff = accessFor("staff");
    const denied: ShellAccess = { access: { ...staff, permissions: { ...staff.permissions, "assistant.view": false } }, controls: DEFAULT_SECTION_CONTROLS };
    expect(pageDecision(denied, "ask_kiara")).toBe("denied");
    expect(buildLauncherItems(denied).some((item) => item.id === "ask_kiara")).toBe(false);
    const { calls, handlers } = recorder();
    expect(navigatePath("/ask-kiara?conversation=c1", denied, handlers)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("opens /ask-kiara links, with their query, on the Section stack", () => {
    expect(resolveNativeDestination("/ask-kiara")).toEqual({ kind: "section", page: "ask_kiara" });
    expect(resolveNativeDestination("/ask-kiara?conversation=c1")).toEqual({ kind: "section", page: "ask_kiara" });
    const { calls, handlers } = recorder();
    expect(navigatePath("/ask-kiara?tab=questions&escalation=e1", shellFor("manager"), handlers)).toBe(true);
    expect(calls).toEqual(["path:/ask-kiara?tab=questions&escalation=e1", "section:ask_kiara"]);
  });

  it("keeps exact matching for tab pages that carry a query", () => {
    expect(resolveNativeDestination("/tasks?tab=delegated")).toBeNull();
    expect(resolveNativeDestination("/not-a-page?x=1")).toBeNull();
  });

  it("Ask Kiara notifications (question for you, answered) open the screen", () => {
    expect(nativeNotificationAction("/ask-kiara?tab=questions&escalation=e1")).toEqual({ kind: "open", path: "/ask-kiara?tab=questions&escalation=e1" });
    expect(nativeNotificationAction("/ask-kiara?conversation=c1")).toEqual({ kind: "open", path: "/ask-kiara?conversation=c1" });
    expect(nativeNotificationAction("/tasks")).toEqual({ kind: "open", path: "/tasks" });
    expect(nativeNotificationAction("https://evil.example/x")).toBeNull();
    expect(nativeNotificationAction(null)).toBeNull();
  });

  it("hides the floating voice-task button only on Ask Kiara, whose composer has its own mic", () => {
    expect(hidesGlobalVoiceAction("ask_kiara")).toBe(true);
    expect(hidesGlobalVoiceAction("dashboard")).toBe(false);
    expect(hidesGlobalVoiceAction("checklist_tasks")).toBe(false);
  });

  it("adds Ask Kiara in the web launcher position and leaves every other entry unchanged", () => {
    expect(buildLauncherItems(shellFor("staff")).map((item) => item.id)).toEqual(["home", "dashboard", "fms_builder", "forms_library", "availability", "reports", "ask_kiara", "settings"]);
  });
});
