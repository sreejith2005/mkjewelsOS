// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/next-shim/navigation", () => ({ usePathname: () => "/clients" }));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/client-search", () => ({ ClientSearch: () => null }));
vi.mock("@/components/post-call-inbox", () => ({ PostCallInbox: () => null }));
vi.mock("@/crm-port/jewelos-home-link", () => ({ JewelosHomeLink: () => null }));
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));

import { CrmShell } from "@/components/crm-shell";
import { CrmThemeContext } from "@/crm-port/theme-context";

const profile = { name: "Sample Person", role: "salesperson", branch_name: "Sample Branch" };
afterEach(cleanup);

describe("CRM header theme switch", () => {
  it("is absent when the host does not supply the JewelOS theme (Android WebView)", () => {
    render(<CrmShell profile={profile}>content</CrmShell>);
    expect(screen.queryByRole("button", { name: /Switch to (dark|light) mode/ })).toBeNull();
  });

  it("switches the JewelOS theme from the CRM header", () => {
    const onThemeChange = vi.fn();
    const { rerender } = render(<CrmThemeContext.Provider value={{ theme: "light", onThemeChange }}><CrmShell profile={profile}>content</CrmShell></CrmThemeContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
    rerender(<CrmThemeContext.Provider value={{ theme: "dark", onThemeChange }}><CrmShell profile={profile}>content</CrmShell></CrmThemeContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
    expect(onThemeChange).toHaveBeenLastCalledWith("light");
  });
});
