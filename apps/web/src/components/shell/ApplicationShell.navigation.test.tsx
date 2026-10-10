// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserProfile } from "@/types";
import { ApplicationShell, type ShellNavItem } from "./ApplicationShell";

vi.mock("@/features/notifications/NotificationBell", () => ({ NotificationBell: () => null }));

const profile: UserProfile = {
  account_status: "active", auth_user_id: "test-auth", branch_id: "test-branch",
  buddy_id: null, created_at: null, created_by: null, department_id: "test-department",
  designation_id: null, email: "staff@example.test", employee_code: "TEST-1",
  employee_name: "Test Employee", first_name: null, id: "test-profile",
  is_login_enabled: true, last_name: null, official_email: null, official_mobile: null,
  personal_email: null, personal_mobile: null, reports_to_user_id: null,
  secondary_buddy_id: null, tenant_id: "test-tenant", updated_at: null, updated_by: null,
  user_role: "staff", username: null, week_off: [], working_status: "active",
};

const nav: readonly ShellNavItem[] = [
  { Icon: Home, id: "home", label: "Home", path: "/" },
  { Icon: Home, id: "checklist_tasks", label: "Tasks", path: "/tasks" },
  { Icon: Home, id: "users", label: "Users", path: "/users" },
  { Icon: Home, id: "reports", label: "Reports", path: "/reports" },
  { Icon: Home, id: "dropdown_master", label: "Dropdown Master", path: "/dropdown-master" },
  { Icon: Home, id: "settings", label: "Settings", path: "/settings" },
];

afterEach(cleanup);

function ShellHarness({ navigate }: { navigate: (path: string) => void }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  return (
    <ApplicationShell
      branch={null} currentPage="home" drawerOpen={false} launcherItems={[]}
      logoDarkUrl="/logo-dark.svg" logoLightUrl="/logo-light.svg" nav={nav}
      navigate={navigate} onDrawerOpenChange={vi.fn()} onLogout={async () => {}}
      path="/" profile={profile} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
      theme="dark" onThemeChange={vi.fn()}
    >
      Section content
    </ApplicationShell>
  );
}

describe("desktop sidebar selection", () => {
  it.each(nav)("opens $label, closes the sidebar, and lets the hamburger reopen it", async (item) => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { container } = render(<ShellHarness navigate={navigate} />);
    const group = ["reports", "dropdown_master", "settings"].includes(item.id)
      ? "System navigation" : "Primary navigation";

    await user.click(within(screen.getByRole("navigation", { name: group })).getByRole("button", { name: item.label }));

    expect(navigate).toHaveBeenCalledExactlyOnceWith(item.path);
    expect(container.querySelector("aside")?.classList.contains("-translate-x-full")).toBe(true);
    expect(screen.getByRole("main").classList.contains("md:pl-64")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Toggle sidebar" }));

    expect(container.querySelector("aside")?.classList.contains("translate-x-0")).toBe(true);
    expect(screen.getByRole("main").classList.contains("md:pl-64")).toBe(true);
  });
});
