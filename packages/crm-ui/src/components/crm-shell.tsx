"use client";

import Image from "@/next-shim/image"; // crm-port: next/image -> local shim
import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { usePathname } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { useEffect, useRef, useState } from "react";

import { signOut } from "@/app/actions";
import { JewelosHomeLink } from "@/crm-port/jewelos-home-link"; // crm-port: "← JewelOS" menu link
import { useCrmLayout } from "@/crm-port/layout-context";
import { useSearchParams } from "@/next-shim/navigation";
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

// crm-port: the CRM's own tabs when it is a JewelOS section (owner request 2026-11-03). JewelOS
// keeps its header, sidebar, theme switch and sign-out; these tabs only move between CRM pages.
// Paths are unchanged, so every existing /crm deep link still opens the same page.
export const CRM_SECTION_TABS = [
  { label: "REGISTRATION", href: "/queue", icon: "walkin" },
  { label: "CLIENT QUEUE", href: "/queue?register=client", icon: "walkin" },
  { label: "CLIENT DATABASE", href: "/clients", icon: "clients" },
  { label: "DASHBOARD", href: "/dashboard", icon: "dashboard" },
  { label: "NOT BOUGHT FOLLOW UP", href: "/followups", icon: "followup" },
  { label: "REFERRALS", href: "/referrals", icon: "referral" },
] as const;

/** The tab that owns a CRM page: the walk-in visit form belongs to the client queue. */
export function activeCrmSectionTab(pathname: string, register: string | null): (typeof CRM_SECTION_TABS)[number]["href"] | null {
  if (pathname === "/queue") return register === "client" ? "/queue?register=client" : "/queue";
  if (pathname === "/visits/new") return "/queue?register=client";
  if (pathname === "/leads/new") return "/queue";
  for (const href of ["/clients", "/dashboard", "/followups", "/referrals"] as const) if (pathname === href || pathname.startsWith(`${href}/`)) return href;
  return null;
}

// crm-port: on desktop the CRM sections are a slim second sidebar beside the JewelOS one
// (owner request 2026-11-04); on phones and tablets they stay a scrolling strip whose open
// section is always scrolled into view. The links and their order are the same either way.
function CrmSectionShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const register = useSearchParams().get("register");
  const active = activeCrmSectionTab(pathname, register);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const current = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [active]);
  return <div className="crm-app crm-section">
    <nav className="crm-section-tabs" aria-label="CRM sections" ref={navRef}>
      <p className="crm-section-nav-title" aria-hidden="true">CRM</p>
      {CRM_SECTION_TABS.map(({ label, href, icon }) => <Link className={`crm-section-tab${active === href ? " is-active" : ""}`} aria-current={active === href ? "page" : undefined} href={href} key={href}><CrmIcon name={icon} /><span>{label}</span></Link>)}
    </nav>
    <div className="crm-section-body">
      <div className="crm-section-bar">
        <div className="crm-section-search"><ClientSearch /></div>
      </div>
      <div className="crm-main">{children}</div>
    </div>
    <PostCallInbox />
  </div>;
}

export function CrmShell({ profile, children }: { profile: { name: string; role: string; branch_name: string | null }; children: React.ReactNode }) {
  // crm-port: inside the JewelOS shell the CRM shows only its section tabs.
  if (useCrmLayout() === "section") return <CrmSectionShell>{children}</CrmSectionShell>;
  return <CrmStandaloneShell profile={profile}>{children}</CrmStandaloneShell>;
}

function CrmStandaloneShell({ profile, children }: { profile: { name: string; role: string; branch_name: string | null }; children: React.ReactNode }) {
  const navigation = [["DASHBOARD", "/dashboard", "dashboard"], ["CLIENT WALK-IN FORM", "/queue", "walkin"], ["NOT BOUGHT FOLLOW UP", "/followups", "followup"], ["REFERRALS CALLING", "/referrals", "referral"], ["CLIENT DATABASE", "/clients", "clients"]] as const; // crm-port: ROSTER / ALLOCATION removed; the roster follows JewelOS Users and Availability
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();
  const themeControl = useCrmTheme();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const navigationLinks = navigation.map(([label, href, icon]) => {
    const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
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
