// crm-port: next/navigation redirect("/login") -> JewelOS login / no-access screen (below).
import { CrmShell } from "@/components/crm-shell";
import { createClient } from "@/lib/supabase/server";
import { leaveForJewelosLogin, NoCrmAccess } from "@/crm-port/access";
export default async function CrmLayout({ children }: { children: React.ReactNode }) { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) leaveForJewelosLogin() /* crm-port: redirect("/login") -> JewelOS login */; const { data } = await supabase.rpc("get_my_profile"); const profile = data?.[0]; if (!profile) return <NoCrmAccess /> /* crm-port: redirect("/login") -> "No CRM access, ask an admin" */; return <CrmShell profile={profile}>{children}</CrmShell>; }
