// @vitest-environment jsdom
// CRM as a JewelOS section (owner request 2026-11-03): inside the JewelOS shell the CRM shows only
// its own tabs; JewelOS keeps the header, sidebar, theme switch and sign-out.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as baseRender, screen } from "@testing-library/react";
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
vi.mock("@/components/entry-queue", () => ({ EntryQueue: () => <p>REGISTER CLIENT ENTRY</p> }));
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
  it("shows the CRM tabs and search but no second header, drawer, theme switch, sign-out or JewelOS link", () => {
    renderSection();
    const tabs = screen.getByRole("navigation", { name: "CRM sections" });
    expect([...tabs.querySelectorAll("a")].map((link) => link.textContent)).toEqual(["REGISTRATION", "CLIENT QUEUE", "CLIENT DATABASE", "DASHBOARD", "NOT BOUGHT FOLLOW UP", "REFERRALS"]);
    expect(screen.getByRole("searchbox", { name: "Search clients" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open navigation menu" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Switch to (dark|light) mode/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /LOGOUT/ })).toBeNull();
    expect(screen.queryByText("← JewelOS")).toBeNull();
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("keeps the original CRM header in the standalone (embedded) layout", () => {
    render(<CrmShell profile={profile}>content</CrmShell>);
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "CRM sections" })).toBeNull();
  });

  it("marks the tab that owns the current page", () => {
    navigation.pathname = "/clients/10000000-0000-4000-8000-000000000001";
    renderSection();
    expect(screen.getByRole("link", { name: "CLIENT DATABASE" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "REGISTRATION" }).getAttribute("aria-current")).toBeNull();
  });

  it("maps every CRM page to its tab", () => {
    expect(activeCrmSectionTab("/queue", null)).toBe("/queue");
    expect(activeCrmSectionTab("/queue", "lead")).toBe("/queue");
    expect(activeCrmSectionTab("/queue", "client")).toBe("/queue?register=client");
    expect(activeCrmSectionTab("/visits/new", null)).toBe("/queue?register=client");
    expect(activeCrmSectionTab("/leads/new", null)).toBe("/queue");
    expect(activeCrmSectionTab("/clients/new", null)).toBe("/clients");
    expect(activeCrmSectionTab("/dashboard", null)).toBe("/dashboard");
    expect(activeCrmSectionTab("/followups", null)).toBe("/followups");
    expect(activeCrmSectionTab("/referrals", null)).toBe("/referrals");
    expect(activeCrmSectionTab("/unknown", null)).toBeNull();
    expect(new Set(CRM_SECTION_TABS.map((tab) => tab.href)).size).toBe(CRM_SECTION_TABS.length);
  });
});

describe("CRM registration chooser", () => {
  const props = { entryQueueProps: {} as never, fields: [], options: [], lookupOptions: {}, actorId: "actor" };

  it("opens on the Client / Walk-in or Lead choice", () => {
    render(<WalkinStart {...props} />);
    expect(screen.getByRole("heading", { name: "Who are you registering?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /CLIENT \/ WALK-IN/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /LEAD/ })).toBeTruthy();
  });

  it("puts the choice in the address so back/forward and the CLIENT QUEUE tab work", () => {
    navigation.search = "?branch=b1&completed=Asha&completedClientId=c1";
    render(<WalkinStart {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /CLIENT \/ WALK-IN/ }));
    expect(navigation.push).toHaveBeenCalledWith("/queue?branch=b1&register=client");
  });

  it("shows the client queue or the lead form from the address and goes back to the choice", () => {
    navigation.search = "?register=client&branch=b1";
    const { rerender } = render(<WalkinStart {...props} />);
    expect(screen.getByText("REGISTER CLIENT ENTRY")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to registration type" }));
    expect(navigation.push).toHaveBeenCalledWith("/queue?branch=b1");
    navigation.search = "?register=lead";
    rerender(<WalkinStart {...props} />);
    expect(screen.getByText("LEAD FORM")).toBeTruthy();
  });

  it("ignores unknown registration values", () => {
    expect(registrationChoice("client")).toBe("client");
    expect(registrationChoice("lead")).toBe("lead");
    expect(registrationChoice("other")).toBe("");
    expect(registrationChoice(null)).toBe("");
  });
});
