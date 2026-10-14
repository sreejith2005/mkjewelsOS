"use client";

import Image from "@/next-shim/image"; // crm-port: next/image -> local shim
import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { usePathname } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { useEffect, useState } from "react";

import { signOut } from "@/app/actions";
import { JewelosHomeLink } from "@/crm-port/jewelos-home-link"; // crm-port: "← JewelOS" menu link
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

export function CrmShell({ profile, children }: { profile: { name: string; role: string; branch_name: string | null }; children: React.ReactNode }) {
  const navigation = [["DASHBOARD", "/dashboard", "dashboard"], ["CLIENT WALK-IN FORM", "/queue", "walkin"], ["NOT BOUGHT FOLLOW UP", "/followups", "followup"], ["REFERRALS CALLING", "/referrals", "referral"], ["CLIENT DATABASE", "/clients", "clients"]] as const; // crm-port: ROSTER / ALLOCATION removed; the roster follows JewelOS Users and Availability
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

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
      <span className="crm-topbar-status"><span className="crm-topbar-who"><b>{profile.name}</b><small>{branch}</small></span><span className="crm-avatar" aria-hidden="true">{initials(profile.name)}</span></span>
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
