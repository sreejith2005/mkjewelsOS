// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ loadInbox: vi.fn().mockResolvedValue([]), subscribeToInbox: () => () => {}, markNotification: vi.fn() }));
import { NotificationBell } from "./NotificationBell";
afterEach(cleanup);
it("shows the full unread total independently of the recent inbox preview", () => {
  const { rerender } = render(<NotificationBell profileId="profile" onNavigate={vi.fn()} unreadCount={701} />);
  expect(screen.getByRole("button", { name: "Notifications, 701 unread" })).toBeTruthy();
  rerender(<NotificationBell profileId="profile" onNavigate={vi.fn()} unreadCount={0} />);
  expect(screen.getByRole("button", { name: "Notifications, none unread" })).toBeTruthy();
});
