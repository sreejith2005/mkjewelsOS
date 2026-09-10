import { describe, expect, it } from "vitest";
import { filterNotificationInbox, notificationDestination } from "./inbox";

const items = [
  { id: "1", event_type: "task_assigned", title: "New task", message: "Count stock", link_url: "/tasks", is_read: false, priority: "high" },
  { id: "2", event_type: "form_approved", title: "Form approved", message: "Opening", link_url: "https://evil.example", is_read: true, priority: "medium" },
] as const;

describe("notification inbox presentation", () => {
  it("combines unread, event, priority, and text filters", () => {
    expect(filterNotificationInbox(items, { unreadOnly: true, eventType: "task_assigned", priority: "high", search: "stock" }).map((item) => item.id)).toEqual(["1"]);
  });

  it("allows only safe internal notification destinations", () => {
    expect(notificationDestination("/forms?id=1")).toBe("/forms?id=1");
    expect(notificationDestination("https://evil.example")).toBeNull();
  });
});
