import type { ReactNode } from "react";
import { PAGE_SCROLL_ATTRIBUTE } from "@/crm-port/mobile-tables";

/**
 * Client Database views (owner request 2026-11-04). "All clients" is the client and lead browser;
 * the others are the Not Bought follow-up cases and both sides of referrals, each read from its
 * own server list (browse_crm_records_page / browse_crm_followups) with its own counts. The view
 * and its tab, filters and page are in the address, so every view can be bookmarked and shared.
 */
export const CLIENT_WORKSPACE_VIEWS = [
  { preset: "", label: "All clients", href: "/clients", hint: "Clients and leads" },
  { preset: "not_bought", label: "Not Bought", href: "/clients?preset=not_bought&tab=pending", hint: "Follow-up cases from not-bought visits" },
  { preset: "referrals_received", label: "Referrals received", href: "/clients?preset=referrals_received&tab=pending", hint: "People introduced by a client" },
  { preset: "referrals_given", label: "Referrals given", href: "/clients?preset=referrals_given&tab=pending", hint: "Clients who introduced someone" },
] as const;

export type ClientWorkspacePreset = (typeof CLIENT_WORKSPACE_VIEWS)[number]["preset"];

/** Client Database page frame: one heading, the view chips, then the view. The document is the only vertical scroller. */
export function ClientWorkspace({ preset, children }: { preset: ClientWorkspacePreset; children: ReactNode }) {
  const pageScroll = { [PAGE_SCROLL_ATTRIBUTE]: "" };
  // The views are in the CRM menu (owner 2026-11-05); the page names the open one.
  const view = CLIENT_WORKSPACE_VIEWS.find((item) => item.preset === preset) ?? CLIENT_WORKSPACE_VIEWS[0];
  return <main className="crm-workspace" {...pageScroll}>
    <header className="crm-workspace-header">
      <h1 className="text-3xl font-semibold">{view.preset ? view.label : "Client database"}</h1>
      <p className="crm-workspace-hint">{view.hint}</p>
    </header>
    {children}
  </main>;
}
