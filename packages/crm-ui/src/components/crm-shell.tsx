"use client";

import Image from "@/next-shim/image"; // crm-port: next/image -> local shim
import Link from "@/next-shim/link"; // crm-port: next/link -> local shim (same hrefs, /crm base path added)
import { usePathname } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)
import { useEffect, useState } from "react";

import { signOut } from "@/app/actions";
import { JewelosHomeLink } from "@/crm-port/jewelos-home-link"; // crm-port: "← JewelOS" menu link
import brandLogo from "@/mk-jewels-logos/WhatsApp Image 2026-06-24 at 13.01.41 (1).jpeg";
import { ClientSearch } from "./client-search";
import { PostCallInbox } from "./post-call-inbox";

function BrandLink() {
  return <Link href="/dashboard" className="crm-brand" aria-label="MK Jewels CRM dashboard">
    <Image className="crm-brand-logo" src={brandLogo} alt="MK Jewels" priority />
    <span className="crm-brand-copy"><span>MK JEWELS CRM</span><small>CLIENT INTELLIGENCE SYSTEM</small></span>
  </Link>;
}

export function CrmShell({ profile, children }: { profile: { name: string; role: string; branch_name: string | null }; children: React.ReactNode }) {
  const navigation = [["DASHBOARD", "/dashboard"], ["CLIENT WALK-IN FORM", "/queue"], ["NOT BOUGHT FOLLOW UP", "/followups"], ["REFERRALS CALLING", "/referrals"], ["CLIENT DATABASE", "/clients"], ["ROSTER / ALLOCATION", "/allocation"]] as const;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const navigationLinks = navigation.map(([label, href]) => <Link className={`crm-nav-link${pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)) ? " is-active" : ""}`} href={href} key={href} onClick={() => setDrawerOpen(false)}>{label}</Link>);
  return <div className="crm-app crm-shell">
    <header className="crm-topbar"><div className="crm-topbar-left"><button type="button" className="crm-menu-button" aria-label="Open navigation menu" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}><span /><span /><span /></button><BrandLink /></div><div className="crm-topbar-search"><ClientSearch /></div><span className="crm-topbar-status">{profile.name} · {profile.branch_name ?? "ALL BRANCHES"}</span></header>
    <button type="button" className={`crm-drawer-backdrop ${drawerOpen ? "is-open" : ""}`} aria-label="Close navigation menu" aria-hidden={!drawerOpen} tabIndex={drawerOpen ? 0 : -1} onClick={() => setDrawerOpen(false)} />
    <aside className={`crm-sidebar ${drawerOpen ? "is-open" : ""}`} aria-label="Main navigation"><div className="crm-sidebar-top"><div><b>MK JEWELS CRM</b><span>NAVIGATION MENU</span></div><button type="button" className="crm-drawer-close" aria-label="Close navigation menu" onClick={() => setDrawerOpen(false)}>×</button></div><nav className="crm-navigation">{navigationLinks}<JewelosHomeLink onNavigate={() => setDrawerOpen(false)} />{/* crm-port: the one JewelOS addition, a link back to JewelOS Home */}</nav><div className="crm-user"><b>{profile.name}</b><span>{profile.role.replace("_", " ")} · {profile.branch_name ?? "All branches"}</span></div><form onSubmit={(event) => { event.preventDefault(); void signOut(); }} /* crm-port: React 18 has no function form actions; the server action becomes a submit handler */><button className="crm-logout">LOGOUT</button></form></aside>
    <div className="crm-main">{children}</div><PostCallInbox />
  </div>;
}
