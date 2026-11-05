// @vitest-environment jsdom
// CRM as a JewelOS section (owner request 2026-11-03): inside the JewelOS shell the CRM shows only
// its own tabs; JewelOS keeps the header, sidebar, theme switch and sign-out. Three tabs since
// 2026-11-04: Dashboard, Client Queue (the landing view), Client Database.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as baseRender, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/queue", search: "", push: vi.fn() }));
vi.mock("@/next-shim/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock("@/next-shim/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/components/client-search", () => ({ ClientSearch: () => <input aria-label="Search clients" type="search" /> }));
vi.mock("@/components/post-call-inbox", () => ({ PostCallInbox: () => null }));
vi.mock("@/crm-port/jewelos-home-link", () => ({ JewelosHomeLink: () => <a href="/">← JewelOS</a> }));
vi.mock("@/app/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/components/entry-queue", () => ({ EntryQueue: () => <p>CRM QUEUE WITH REGISTER CLIENT</p> }));
vi.mock("@/components/lead-form", () => ({ LeadForm: () => <p>LEAD FORM</p> }));

import { activeCrmSectionTab, CrmShell, CRM_SECTION_TABS } from "@/components/crm-shell";
import { registrationChoice, WalkinStart } from "@/components/walkin-start";
import { CrmLayoutContext } from "@/crm-port/layout-context";
import { CrmThemeContext } from "@/crm-port/theme-context";

// WalkinStart reads CRM form links through react-query, as inside the CRM root.
const render = (ui: React.ReactElement) => { const client = new QueryClient(); return baseRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }); };
const profile = { name: "Sample Person", role: "salesperson", branch_name: "Sample Branch" };
beforeEach(() => { navigation.pathname = "/queue"; navigation.search = ""; navigation.push.mockReset(); });
afterEach(cleanup);

function renderSection(children: React.ReactNode = "content") {
  return render(<CrmLayoutContext.Provider value="section"><CrmThemeContext.Provider value={{ theme: "light", onThemeChange: vi.fn() }}><CrmShell profile={profile}>{children}</CrmShell></CrmThemeContext.Provider></CrmLayoutContext.Provider>);
}

describe("CRM inside the JewelOS shell", () => {
  it("shows one menu button named after the open page, the search, and no tab strip, second header, theme switch, sign-out or JewelOS link", () => {
    renderSection();
    expect(screen.queryByRole("navigation", { name: "CRM sections" })).toBeNull();
    const trigger = screen.getByRole("button", { name: /CRM menu, open page: Client queue/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("searchbox", { name: "Search clients" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open navigation menu" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Switch to (dark|light) mode/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /LOGOUT/ })).toBeNull();
    expect(screen.queryByText("← JewelOS")).toBeNull();
    expect(screen.getByText("content")).toBeTruthy();
    // One vertical scroll bar on every CRM page, the page's own (owner 2026-11-05).
    expect(trigger.closest(".crm-section")?.hasAttribute("data-crm-page-scroll")).toBe(true);
  });

  it("opens the hamburger menu with the three pages in order and the Client database views, and closes it on choosing one", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /CRM menu/ }));
    const menu = screen.getByRole("dialog", { name: "CRM sections" });
    expect([...menu.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Dashboard", "/dashboard"], ["Client queue", "/queue"], ["Client database", "/clients"],
      ["Not Bought", "/clients?preset=not_bought&tab=pending"], ["Referrals received", "/clients?preset=referrals_received&tab=pending"], ["Referrals given", "/clients?preset=referrals_given&tab=pending"],
    ]);
    expect(screen.getByRole("link", { name: "Client queue" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("link", { name: "Not Bought" }));
    expect(screen.queryByRole("dialog", { name: "CRM sections" })).toBeNull();
  });

  it("closes the menu with Escape or the backdrop", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /CRM menu/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /CRM menu/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Close CRM menu" })[0]!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names the open page on the menu button, including Client database views", () => {
    navigation.pathname = "/clients"; navigation.search = "?preset=not_bought&tab=today";
    renderSection();
    expect(screen.getByRole("button", { name: /open page: Not Bought/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /CRM menu/ }));
    expect(screen.getByRole("link", { name: "Not Bought" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Client database" }).getAttribute("aria-current")).toBeNull();
    cleanup();
    navigation.pathname = "/clients/10000000-0000-4000-8000-000000000001"; navigation.search = "";
    renderSection();
    expect(screen.getByRole("button", { name: /open page: Client profile/ })).toBeTruthy();
  });

  it("never traps the mouse wheel inside a sideways-scrolling CRM table", () => {
    const css = readFileSync(join(__dirname, "../src/crm-port/wide.css"), "utf8");
    expect(css).toMatch(/\[data-crm-page-scroll\] \[class\*="overflow-x-auto"\]:has\(> table\[data-crm-cards\]\) \{[^}]*overscroll-behavior: auto;/);
  });

  it("keeps the original CRM header in the standalone (embedded) layout, with the same three pages", () => {
    render(<CrmShell profile={profile}>content</CrmShell>);
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toBeTruthy();
    expect(screen.getAllByRole("link").map((link) => link.textContent).filter((text) => ["Dashboard", "Client queue", "Client database", "NOT BOUGHT FOLLOW UP", "REFERRALS CALLING"].includes(text ?? ""))).toEqual(["Dashboard", "Client queue", "Client database"]);
  });

  it("maps every CRM page to its tab", () => {
    expect(activeCrmSectionTab("/queue")).toBe("/queue");
    expect(activeCrmSectionTab("/visits/new")).toBe("/queue");
    expect(activeCrmSectionTab("/leads/new")).toBe("/queue");
    expect(activeCrmSectionTab("/clients/new")).toBe("/clients");
    expect(activeCrmSectionTab("/followups")).toBe("/clients");
    expect(activeCrmSectionTab("/referrals")).toBe("/clients");
    expect(activeCrmSectionTab("/dashboard")).toBe("/dashboard");
    expect(activeCrmSectionTab("/unknown")).toBeNull();
    expect(new Set(CRM_SECTION_TABS.map((tab) => tab.href)).size).toBe(CRM_SECTION_TABS.length);
  });
});

describe("Client Queue landing (no registration chooser)", () => {
  const props = { entryQueueProps: {} as never, fields: [], options: [], lookupOptions: {}, actorId: "actor" };

  it("opens straight on the queue with small Register client and Register lead buttons side by side", () => {
    render(<WalkinStart {...props} />);
    expect(screen.queryByRole("heading", { name: "Who are you registering?" })).toBeNull();
    expect(screen.getByText("CRM QUEUE WITH REGISTER CLIENT")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Register client" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Register lead" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("opens the lead form in the address and goes back to the queue, keeping the branch", () => {
    navigation.search = "?branch=b1&completed=Asha&completedClientId=c1";
    render(<WalkinStart {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Register lead" }));
    expect(navigation.push).toHaveBeenCalledWith("/queue?branch=b1&register=lead");
  });

  it("shows the lead form from the address with a way back to the queue", () => {
    navigation.search = "?register=lead&branch=b1";
    const { rerender } = render(<WalkinStart {...props} />);
    expect(screen.getByText("LEAD FORM")).toBeTruthy();
    expect(screen.queryByText("CRM QUEUE WITH REGISTER CLIENT")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to queue" }));
    expect(navigation.push).toHaveBeenCalledWith("/queue?branch=b1");
    navigation.search = "?register=client";
    rerender(<WalkinStart {...props} />);
    expect(screen.getByText("CRM QUEUE WITH REGISTER CLIENT")).toBeTruthy();
  });

  it("treats old and unknown registration values as the queue", () => {
    expect(registrationChoice("client")).toBe("client");
    expect(registrationChoice("lead")).toBe("lead");
    expect(registrationChoice("other")).toBe("client");
    expect(registrationChoice(null)).toBe("client");
  });
});
