// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyPageErrorBoundary } from "@/components/LazyPageErrorBoundary";
import { NotificationInbox } from "./NotificationInbox";
import { ProviderStatus } from "./ProviderStatus";
import type { InboxNotification } from "./types";

const apiMocks = vi.hoisted(() => ({ markNotification: vi.fn(), markAllNotifications: vi.fn() }));
vi.mock("./api", () => apiMocks);

const item: InboxNotification = { id: "notice-1", event_type: "task_assigned", title: "Assigned", message: "A task is ready", link_url: "/tasks/checklist", is_read: false, read_at: null, priority: "medium", created_at: "2026-08-10T12:00:00Z" };
afterEach(() => cleanup());

describe("notification rendered states", () => {
  it("renders loading, empty, ready, and safe malformed values", () => {
    const props = { error: null, onRefresh: vi.fn().mockResolvedValue(undefined), onNavigate: vi.fn() };
    const first = render(<NotificationInbox {...props} items={[]} loading />);
    expect(screen.getByLabelText("Loading notifications")).toBeTruthy(); first.unmount();
    const second = render(<NotificationInbox {...props} items={[]} loading={false} />);
    expect(screen.getByText("Nothing here")).toBeTruthy(); second.unmount();
    render(<NotificationInbox {...props} items={[{ ...item, title: null as never, message: null as never, event_type: null as never, created_at: "not-a-date" }]} loading={false} />);
    expect(screen.getByText("Notification")).toBeTruthy();
  });

  it("shows retry and visible mark-read failure instead of an unhandled rejection", async () => {
    const user = userEvent.setup(); apiMocks.markNotification.mockRejectedValueOnce(new Error("Read update failed"));
    const failed = render(<NotificationInbox error="Inbox request failed" items={[]} loading={false} onNavigate={vi.fn()} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    failed.unmount();
    const mounted = render(<NotificationInbox error={null} items={[item]} loading={false} onNavigate={vi.fn()} onRefresh={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: /^Mark read$/ }));
    await waitFor(() => expect(screen.getByText("Read update failed")).toBeTruthy()); mounted.unmount();
  });

  it("renders a fallback provider icon and label for an unknown channel", () => {
    render(<ProviderStatus providers={[{ channel: "carrier_pigeon" as never, is_available: false, provider_identifier: null, status_reason: null as never }]} />);
    expect(screen.getByText("carrier pigeon")).toBeTruthy();
    expect(screen.getByText("Provider status is unavailable.")).toBeTruthy();
  });

  it("contains a throwing lazy page in a recoverable panel", () => {
    const Throwing = (): never => { throw new Error("synthetic render failure"); };
    render(<LazyPageErrorBoundary onNavigate={vi.fn()}><Throwing /></LazyPageErrorBoundary>);
    expect(screen.getByText("This page could not be displayed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
