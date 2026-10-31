// crm-port: next/navigation redirect("/login") -> JewelOS login / no-access screen (below).
import { CrmShell } from "@/components/crm-shell";
import { createClient } from "@/lib/supabase/server";
import { leaveForJewelosLogin, NoCrmAccess } from "@/crm-port/access";
import { assertCrmRead } from "@/crm-port/read-results";
export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = assertCrmRead(await supabase.auth.getUser());
  if (!user) leaveForJewelosLogin();
  const { data } = assertCrmRead(await supabase.rpc("get_my_profile"));
  const profile = data?.[0];
  if (!profile) return <NoCrmAccess />;
  return <CrmShell profile={profile}>{children}</CrmShell>;
}
