import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorPanel, LoadingPanels } from "./components";
import { asyncPresentation, dashboardSectionsForRole, exportActionsForStatus, homeSectionsForRole, reportSearch, settingsSectionsForRole } from "./presentation";

describe("dashboard and report presentation contracts", () => {
  it("keeps CRM follow-ups out of HR, staff, doer, and housekeeping Home", () => {
    for (const role of ["hr", "staff", "doer", "housekeeping"] as const) expect(homeSectionsForRole(role)).not.toContain("crm_followups");
    expect(homeSectionsForRole("crm")).toContain("crm_followups");
  });

  it("separates role-specific dashboard content", () => {
    expect(dashboardSectionsForRole("hr")).toContain("people");
    expect(dashboardSectionsForRole("hr")).not.toContain("crm");
    expect(dashboardSectionsForRole("housekeeping")).toEqual(["personal_tasks", "fms", "forms", "notifications"]);
    expect(dashboardSectionsForRole("admin")).toContain("delivery_health");
  });

  it("hides organization controls from regular roles", () => {
    expect(settingsSectionsForRole("manager")).toContain("branch");
    expect(settingsSectionsForRole("manager")).not.toContain("tenant");
    expect(settingsSectionsForRole("crm")).toEqual(["account", "preferences", "session"]);
  });

  it("maps all asynchronous states without ambiguity", () => {
    expect(asyncPresentation(true, null, 0)).toBe("loading");
    expect(asyncPresentation(false, "denied", 0)).toBe("error");
    expect(asyncPresentation(false, null, 0)).toBe("empty");
    expect(asyncPresentation(false, null, 1)).toBe("ready");
  });

  it("renders loading and keyboard-retry controls accessibly", () => {
    expect(renderToStaticMarkup(<LoadingPanels count={2}/>)).toContain("animate-pulse");
    const markup = renderToStaticMarkup(<ErrorPanel message="Safe error" onRetry={() => undefined}/>);
    expect(markup).toContain("Safe error");
    expect(markup).toContain("button");
    expect(markup).toContain("Retry");
  });

  it("synchronizes deterministic URL-backed report filters", () => {
    expect(reportSearch("task_operations", { from: "2026-08-01", to: "2026-08-10", page: 2 })).toBe("?report=task_operations&from=2026-08-01&to=2026-08-10&page=2");
  });

  it("shows only valid export lifecycle actions", () => {
    expect(exportActionsForStatus("queued")).toEqual(["cancel"]);
    expect(exportActionsForStatus("processing")).toEqual(["cancel"]);
    expect(exportActionsForStatus("completed")).toEqual(["download"]);
    expect(exportActionsForStatus("failed")).toEqual(["retry"]);
    expect(exportActionsForStatus("expired")).toEqual(["retry"]);
    expect(exportActionsForStatus("cancelled")).toEqual([]);
  });

  it("keeps responsive report layouts represented by both table and card breakpoints", async () => {
    const source = await import("../reports/ReportsView?raw").then((module) => module.default as string);
    expect(source).toContain("hidden overflow-x-auto sm:block");
    expect(source).toContain("grid gap-3 sm:hidden");
  });

  it("keeps chart essentials available through a labelled SVG trend", async () => {
    const source = await import("./DashboardView?raw").then((module) => module.default as string);
    expect(source).toContain("Task Performance Trend");
    expect(source).toContain('aria-label="Task completion trend with directly labelled daily values"');
    expect(source).toContain("role=\"img\"");
    expect(source).toContain("{point.completed}");
  });
});
