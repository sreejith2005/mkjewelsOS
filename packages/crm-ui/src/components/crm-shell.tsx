"use client";

import Image from "@/next-shim/image"; // crm-port: next/image -> local shim
import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { usePathname, useSearchParams } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/app/actions";
import { JewelosHomeLink } from "@/crm-port/jewelos-home-link"; // crm-port: "← JewelOS" menu link
import { useCrmLayout } from "@/crm-port/layout-context";
import { usePendingHref } from "@/crm-port/navigation-context";
import { PAGE_SCROLL_ATTRIBUTE } from "@/crm-port/mobile-tables";
import { useCrmTheme } from "@/crm-port/theme-context";
import brandWordmark from "@/mk-jewels-logos/mk-jewels-wordmark.png";
import { ClientSearch } from "./client-search";
import { CLIENT_WORKSPACE_VIEWS } from "./client-workspace";
import { CrmIcon } from "./crm-icon";
import { PostCallInbox } from "./post-call-inbox";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function BrandLink() {
  return <Link href="/dashboard" className="crm-brand" aria-label="MK Jewels CRM dashboard">
    <Image className="crm-brand-logo" src={brandWordmark} alt="MK Jewels" priority />
    <span className="crm-brand-tag">CRM</span>
  </Link>;
}

// crm-port: the CRM's three tabs (owner request 2026-11-04): Dashboard, Client Queue, Client
// Database. Opening CRM lands on Client Queue (app/page.tsx). Not Bought follow-ups and both sides
// of referrals live inside Client Database as presets; their old addresses redirect there.
export const CRM_SECTION_TABS = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Client queue", href: "/queue", icon: "walkin" },
  { label: "Client database", href: "/clients", icon: "clients" },
] as const;

export type CrmSectionHref = (typeof CRM_SECTION_TABS)[number]["href"];

/** The tab that owns a CRM page: registration, walk-in and lead forms belong to the client queue. */
export function activeCrmSectionTab(pathname: string): CrmSectionHref | null {
  if (pathname === "/queue" || pathname === "/visits/new" || pathname === "/leads/new") return "/queue";
  if (pathname === "/followups" || pathname === "/referrals") return "/clients";
  for (const href of ["/clients", "/dashboard"] as const) if (pathname === href || pathname.startsWith(`${href}/`)) return href;
  return null;
}

/** The Client Database view a CRM address shows ("" = All clients), or null off Client Database. */
export function clientViewOf(pathname: string, search: string): string | null {
  if (pathname === "/followups") return "not_bought";
  if (pathname === "/referrals") return "referrals_received";
  if (pathname !== "/clients") return null;
  return new URLSearchParams(search).get("preset") ?? "";
}

/** The name of the open CRM page, shown on the menu button. */
export function crmPageTitle(pathname: string, search: string): string {
  const view = clientViewOf(pathname, search);
  if (view !== null) return CLIENT_WORKSPACE_VIEWS.find((item) => item.preset === view)?.label ?? "Client database";
  if (pathname.startsWith("/clients/")) return "Client profile";
  if (pathname === "/visits/new") return "Walk-in form";
  if (pathname === "/leads/new") return "Register lead";
  return CRM_SECTION_TABS.find((tab) => tab.href === activeCrmSectionTab(pathname))?.label ?? "CRM";
}

// crm-port: the CRM pages are in a hamburger menu (owner request 2026-11-05): one small bar with the
// menu button (named after the open page) and the client search, so the page has the whole screen.
// Choosing a page opens it and closes the menu; Escape or tapping outside closes it too.
function CrmSectionShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  // While a page loads, its menu entry and title switch at once (2026-11-05): the tap answers at once.
  const pendingHref = usePendingHref();
  const [shownPath, shownSearch] = pendingHref ? [pendingHref.split("?")[0]!, pendingHref.split("?")[1] ?? ""] : [pathname, search];
  const active = activeCrmSectionTab(shownPath);
  const activeView = clientViewOf(shownPath, shownSearch);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('[aria-current="page"], a')?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const close = () => setOpen(false);
  // One vertical scroll bar on every CRM page, the page's own, as in the rest of JewelOS (owner 2026-11-05).
  return <div className="crm-app crm-section" {...{ [PAGE_SCROLL_ATTRIBUTE]: "" }}>
    {pendingHref ? <div className="crm-progress" role="progressbar" aria-label="Opening page" /> : null}
    <div className="crm-section-bar">
      <button ref={triggerRef} type="button" className="crm-menu-trigger" aria-haspopup="dialog" aria-expanded={open} aria-controls="crm-section-menu" onClick={() => setOpen(true)}>
        <span className="crm-menu-trigger-icon" aria-hidden="true"><span /><span /><span /></span>
        <span className="crm-menu-trigger-label"><span className="sr-only">CRM menu, open page: </span>{crmPageTitle(shownPath, shownSearch)}</span>
      </button>
      <div className="crm-section-search"><ClientSearch /></div>
    </div>
    {open ? <>
      <button type="button" className="crm-menu-backdrop" aria-label="Close CRM menu" tabIndex={-1} onClick={close} />
      <nav id="crm-section-menu" ref={panelRef} className="crm-menu-panel" role="dialog" aria-modal="true" aria-label="CRM sections">
        <div className="crm-menu-head"><span>CRM</span><button type="button" className="crm-menu-close" aria-label="Close CRM menu" onClick={() => { close(); triggerRef.current?.focus(); }}>×</button></div>
        {CRM_SECTION_TABS.map(({ label, href, icon }) => <div key={href}>
          <Link className={`crm-menu-link${active === href && (href !== "/clients" || activeView === "" || activeView === null) ? " is-active" : ""}`} aria-current={active === href && (href !== "/clients" || activeView === "") ? "page" : undefined} href={href} preloadData onClick={close}><CrmIcon name={icon} /><span>{href === "/clients" ? "Client database" : label}</span></Link>
          {href === "/clients" ? <div className="crm-menu-sub">{CLIENT_WORKSPACE_VIEWS.filter((view) => view.preset).map((view) => <Link key={view.preset} className={`crm-menu-sublink${activeView === view.preset ? " is-active" : ""}`} aria-current={activeView === view.preset ? "page" : undefined} href={view.href} preloadData onClick={close}>{view.label}</Link>)}</div> : null}
        </div>)}
      </nav>
    </> : null}
    <div className="crm-main">{children}</div>
    <PostCallInbox />
  </div>;
}

export function CrmShell({ profile, children }: { profile: { name: string; role: string; branch_name: string | null }; children: React.ReactNode }) {
  // crm-port: inside the JewelOS shell the CRM shows only its section tabs.
  if (useCrmLayout() === "section") return <CrmSectionShell>{children}</CrmSectionShell>;
  return <CrmStandaloneShell profile={profile}>{children}</CrmStandaloneShell>;
}

function CrmStandaloneShell({ profile, children }: { profile: { name: string; role: string; branch_name: string | null }; children: React.ReactNode }) {
  // crm-port: the same three tabs as the JewelOS section (2026-11-04); ROSTER / ALLOCATION stay removed.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const themeControl = useCrmTheme();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const activeTab = activeCrmSectionTab(pathname);
  const navigationLinks = CRM_SECTION_TABS.map(({ label, href, icon }) => {
    const active = activeTab === href;
    return <Link className={`crm-nav-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined} href={href} key={href} onClick={() => setDrawerOpen(false)}><span className="crm-nav-icon"><CrmIcon name={icon} /></span><span>{label}</span></Link>;
  });
  const branch = profile.branch_name ?? "ALL BRANCHES";
  return <div className="crm-app crm-shell">
    <header className="crm-topbar">
      <div className="crm-topbar-left"><button type="button" className="crm-menu-button" aria-label="Open navigation menu" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><span /><span /><span /></button><BrandLink /></div>
      <div className="crm-topbar-search"><ClientSearch /></div>
      <span className="crm-topbar-status">{themeControl ? <button type="button" className="crm-theme-toggle" aria-label={themeControl.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} aria-pressed={themeControl.theme === "dark"} onClick={() => themeControl.onThemeChange(themeControl.theme === "dark" ? "light" : "dark")}><CrmIcon name={themeControl.theme === "dark" ? "sun" : "moon"} /></button> : null}<span className="crm-topbar-who"><b>{profile.name}</b><small>{branch}</small></span><span className="crm-avatar" aria-hidden="true">{initials(profile.name)}</span></span>
    </header>
    <button type="button" className={`crm-drawer-backdrop ${drawerOpen ? "is-open" : ""}`} aria-label="Close navigation menu" aria-hidden={!drawerOpen} tabIndex={drawerOpen ? 0 : -1} onClick={() => setDrawerOpen(false)} />
    <aside className={`crm-sidebar ${drawerOpen ? "is-open" : ""}`} aria-label="Main navigation">
      <div className="crm-sidebar-top"><div><Image className="crm-sidebar-logo" src={brandWordmark} alt="MK Jewels" /><span>CLIENT RELATIONSHIP</span></div><button type="button" className="crm-drawer-close" aria-label="Close navigation menu" onClick={() => setDrawerOpen(false)}>×</button></div>
      <div className="crm-user"><span className="crm-avatar" aria-hidden="true">{initials(profile.name)}</span><span><b>{profile.name}</b><span>{profile.role.replace("_", " ")} · {profile.branch_name ?? "All branches"}</span></span></div>
      <nav className="crm-navigation">{navigationLinks}<JewelosHomeLink onNavigate={() => setDrawerOpen(false)} />{/* crm-port: the one JewelOS addition, a link back to JewelOS Home */}</nav>
      <form onSubmit={(event) => { event.preventDefault(); void signOut(); }} /* crm-port: React 18 has no function form actions; the server action becomes a submit handler */><button className="crm-logout"><CrmIcon name="logout" />LOGOUT</button></form>
    </aside>
    <div className="crm-main">{children}</div><PostCallInbox />
  </div>;
}
