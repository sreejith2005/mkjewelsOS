// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckCircle2, Home } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNavigationDrawer, type MobileNavigationDrawerItem } from "./MobileNavigationDrawer";

const items: readonly MobileNavigationDrawerItem[] = [
  { Icon: Home, description: "Your daily work", id: "home", label: "Home", path: "/" },
  { Icon: CheckCircle2, description: "Assigned tasks", id: "checklist_tasks", label: "Tasks", path: "/tasks" },
];

afterEach(cleanup);

describe("MobileNavigationDrawer", () => {
  it("navigates through the drawer and closes it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    render(<MobileNavigationDrawer branchName="Bandra" currentPath="/" items={items} onClose={onClose} onLogout={vi.fn()} onNavigate={onNavigate} profileName="Asha Shah" roleLabel="Staff" />);

    await user.click(screen.getByRole("button", { name: /^Tasks/ }));

    expect(onNavigate).toHaveBeenCalledWith("/tasks");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the menu modal and closes it from Escape", () => {
    const onClose = vi.fn();
    render(<MobileNavigationDrawer branchName="Bandra" currentPath="/" items={items} onClose={onClose} onLogout={vi.fn()} onNavigate={vi.fn()} profileName="Asha Shah" roleLabel="Staff" />);

    const dialog = screen.getByRole("dialog", { name: "Navigation" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
