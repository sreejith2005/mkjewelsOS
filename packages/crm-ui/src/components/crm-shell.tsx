"use client";

import Image from "@/next-shim/image"; // crm-port: next/image -> local shim
import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { usePathname } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/app/actions";
import { JewelosHomeLink } from "@/crm-port/jewelos-home-link"; // crm-port: "← JewelOS" menu link
import { useCrmLayout } from "@/crm-port/layout-context";
import { usePendingHref } from "@/crm-port/navigation-context";
import { PAGE_SCROLL_ATTRIBUTE } from "@/crm-port/mobile-tables";
import { useCrmTheme } from "@/crm-port/theme-context";
import brandWordmark from "@/mk-jewels-logos/mk-jewels-wordmark.png";
import { ClientSearch } from "./client-search";
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
  { label: "DASHBOARD", href: "/dashboard", icon: "dashboard" },
  { label: "CLIENT QUEUE", href: "/queue", icon: "walkin" },
  { label: "CLIENT DATABASE", href: "/clients", icon: "clients" },
] as const;

export type CrmSectionHref = (typeof CRM_SECTION_TABS)[number]["href"];

/** The tab that owns a CRM page: registration, walk-in and lead forms belong to the client queue. */
export function activeCrmSectionTab(pathname: string): CrmSectionHref | null {
  if (pathname === "/queue" || pathname === "/visits/new" || pathname === "/leads/new") return "/queue";
  if (pathname === "/followups" || pathname === "/referrals") return "/clients";
  for (const href of ["/clients", "/dashboard"] as const) if (pathname === href || pathname.startsWith(`${href}/`)) return href;
  return null;
}

// crm-port: one bar above the page on every screen (owner request 2026-11-04): the three tabs and
// the client search, so the page below keeps the full width of the JewelOS content area. On phones
// the tabs scroll sideways and the open one is always scrolled into view.
function CrmSectionShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // While a page loads, its tab is already highlighted (2026-11-05): the tap answers at once.
  const pendingHref = usePendingHref();
  const active = activeCrmSectionTab(pendingHref ? pendingHref.split("?")[0]! : pathname);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);
  // One vertical scroll bar on every CRM page, the page's own, as in the rest of JewelOS (owner 2026-11-05).
  return <div className="crm-app crm-section" {...{ [PAGE_SCROLL_ATTRIBUTE]: "" }}>
    {pendingHref ? <div className="crm-progress" role="progressbar" aria-label="Opening page" /> : null}
    <div className="crm-section-bar">
      <nav className="crm-section-tabs" aria-label="CRM sections" ref={navRef}>
        {CRM_SECTION_TABS.map(({ label, href, icon }) => <Link className={`crm-section-tab${active === href ? " is-active" : ""}`} aria-current={active === href ? "page" : undefined} href={href} key={href} preloadData><CrmIcon name={icon} /><span>{label}</span></Link>)}
      </nav>
      <div className="crm-section-search"><ClientSearch /></div>
    </div>
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
