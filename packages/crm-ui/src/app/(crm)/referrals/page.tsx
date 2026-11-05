import { redirect } from "@/next-shim/navigation";
import { legacyListRedirect } from "@/crm-port/followup-page";

// crm-port: referral calling lives in Client Database as Referrals received (owner request
// 2026-11-04). Old links and bookmarks keep their tab, filters, search and page.
export default async function ReferralsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<never> {
  redirect(legacyListRedirect("referrals_received", await searchParams));
}
