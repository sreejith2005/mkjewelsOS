"use client";
// crm-port: the walk-in visit page shows the Form Builder walk-in form linked in CRM Form Settings
// when it is usable (owner request 2026-11-03), and otherwise the standard walk-in form.
import { type ComponentProps } from "react";
import { CRM_WALKIN_TARGETS } from "@jewelos/core";

import { LinkNeedsAttention, linkFor, useCrmFormLinks } from "@/components/crm-linked-forms";
import { LinkedWalkinVisit } from "@/components/linked-walkin-visit";
import { WalkInForm } from "@/components/walk-in-form";
import { useCrmFormsHost } from "@/crm-port/forms-host";

export function WalkinVisitEntry(props: ComponentProps<typeof WalkInForm>) {
  // Without the JewelOS forms host (embedded root, older hosts) only the standard form exists.
  if (!useCrmFormsHost()) return <WalkInForm {...props} />;
  return <LinkedOrStandardWalkin {...props} />;
}

function LinkedOrStandardWalkin(props: ComponentProps<typeof WalkInForm>) {
  const { host, links, loading } = useCrmFormLinks();
  const walkin = linkFor(links, "walkin", CRM_WALKIN_TARGETS);
  if (loading) return <p role="status" className="mt-5 text-sm text-stone-600">Loading the walk-in form…</p>;
  if (host && walkin && !walkin.issues.length && walkin.link.form && props.queue) {
    return <LinkedWalkinVisit client={props.client} crmByBranch={props.crmByBranch ?? {}} host={host} link={walkin.link} profileName={props.profile.name} queue={props.queue} salespeopleByBranch={props.salespeopleByBranch ?? {}} />;
  }
  return <><LinkNeedsAttention canManage={links?.canManage ?? false} usable={walkin} /><WalkInForm {...props} /></>;
}
