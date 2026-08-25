import { describe, expect, it } from "vitest";
import { canAccessPage, getMenuForRole, getPageForPath } from "./roleMenu";

describe("task workspace navigation", () => {
  it("exposes one Tasks menu item", () => {
    const taskItems = getMenuForRole("manager").filter((item) => item.path.startsWith("/tasks"));
    expect(taskItems).toEqual([{ id: "checklist_tasks", label: "Tasks", path: "/tasks" }]);
  });

  it("keeps prior task URLs routed to the combined workspace", () => {
    expect(getPageForPath("/tasks")).toBe("checklist_tasks");
    expect(getPageForPath("/tasks/checklist")).toBe("checklist_tasks");
    expect(getPageForPath("/tasks/delegation")).toBe("checklist_tasks");
    expect(getPageForPath("/tasks/import")).toBe("checklist_tasks");
  });

  it("reserves recurring schedule management for admin roles", () => {
    expect(getPageForPath("/recurring-todo")).toBe("recurring_todo");
    expect(getMenuForRole("admin")).toContainEqual({ id: "recurring_todo", label: "Recurring / To-Do", path: "/recurring-todo" });
    expect(getMenuForRole("manager")).not.toContainEqual(expect.objectContaining({ id: "recurring_todo" }));
    expect(canAccessPage("staff", "recurring_todo")).toBe(false);
    expect(canAccessPage("super_admin", "recurring_todo")).toBe(true);
  });
});
