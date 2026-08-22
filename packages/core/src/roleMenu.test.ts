import { describe, expect, it } from "vitest";
import { getMenuForRole, getPageForPath } from "./roleMenu";

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

  it("routes recurring work to its own workspace", () => {
    expect(getPageForPath("/recurring-todo")).toBe("recurring_todo");
    expect(getMenuForRole("manager")).toContainEqual({ id: "recurring_todo", label: "Recurring / To-Do", path: "/recurring-todo" });
  });
});
