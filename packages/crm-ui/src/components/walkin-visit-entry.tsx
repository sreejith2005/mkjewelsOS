"use client";
// crm-port: the walk-in visit page shows the Form Builder walk-in form linked in CRM Form Settings
// when it is usable (owner request 2026-11-03), and otherwise the standard walk-in form.
import { type ComponentProps, useEffect } from "react";
import { CRM_WALKIN_TARGETS } from "@jewelos/core";

import { LinkNeedsAttention, linkFor, useCrmFormLinks } from "@/components/crm-linked-forms";
import { WalkInForm } from "@/components/walk-in-form";
import { useCrmFormsHost } from "@/crm-port/forms-host";
import { useRouter } from "@/next-shim/navigation"; // crm-port: next/navigation -> local shim (same paths, /crm base path added)

export function WalkinVisitEntry(props: ComponentProps<typeof WalkInForm>) {
  // Without the JewelOS forms host (embedded root, older hosts) only the standard form exists.
  if (!useCrmFormsHost()) return <WalkInForm {...props} />;
  return <LinkedOrStandardWalkin {...props} />;
}

function LinkedOrStandardWalkin(props: ComponentProps<typeof WalkInForm>) {
  const { host, links, loading } = useCrmFormLinks();
  const walkin = linkFor(links, "walkin", CRM_WALKIN_TARGETS);
  const router = useRouter();
  const linked = Boolean(host && walkin && !walkin.issues.length && walkin.link.form && props.queue);
  // The linked walk-in form opens over the Client Queue (owner request 2026-11-06), with its saved
  // draft; this address (client profile, client database, older links) leads there.
  useEffect(() => {
    if (linked && props.queue) router.replace(`/queue?branch=${encodeURIComponent(props.queue.branch_id)}&walkin=${encodeURIComponent(props.queue.id)}`);
  }, [linked, props.queue, router]);
  if (loading) return <p role="status" className="mt-5 text-sm text-stone-600">Loading the walk-in form…</p>;
  if (linked) return <p role="status" className="mt-5 text-sm text-stone-600">Opening the walk-in form in the client queue…</p>;
  return <><LinkNeedsAttention canManage={links?.canManage ?? false} usable={walkin} /><WalkInForm {...props} /></>;
}
