import { describe, expect, it } from "vitest";
import {
  buildLauncherItems,
  isTaskPath,
  pathForTopLevelRoute,
  resolveNativeDestination,
  themeToggleLabel,
} from "./shellModel";

describe("resolveNativeDestination", () => {
  it.each([
    ["/", "Home"],
    ["/tasks", "Tasks"],
    ["/tasks/checklist", "Tasks"],
    ["/tasks/delegation", "Tasks"],
    ["/tasks/import", "Tasks"],
    ["/tasks/assigning-left", "Tasks"],
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
  expect(isTaskPath("/tasks/fms")).toBe(true);
  expect(isTaskPath("/tasks/import")).toBe(true);
  expect(isTaskPath("/task-templates")).toBe(false);
});

describe("buildLauncherItems", () => {
  it("keeps the approved web launcher order and descriptions", () => {
    const items = buildLauncherItems("staff");
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

  it("does not expose pages forbidden to the role", () => {
    expect(buildLauncherItems("housekeeping").some((item) => item.id === "crm")).toBe(false);
  });
});

it("uses the approved web paths for visible native tabs", () => {
  expect(pathForTopLevelRoute("Home")).toBe("/");
  expect(pathForTopLevelRoute("Tasks")).toBe("/tasks");
  expect(pathForTopLevelRoute("Fms")).toBe("/tasks/fms");
  expect(pathForTopLevelRoute("Crm")).toBe("/crm");
});

it("describes the theme the toggle will activate", () => {
  expect(themeToggleLabel("light")).toBe("Switch to dark mode");
  expect(themeToggleLabel("dark")).toBe("Switch to light mode");
});
