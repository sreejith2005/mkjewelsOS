import { redirect } from "@/next-shim/navigation";
import { legacyListRedirect } from "@/crm-port/followup-page";

// crm-port: Not Bought follow-ups live in Client Database (owner request 2026-11-04). Old links and
// bookmarks keep their tab, filters, search and page.
export default async function FollowupsPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<never> {
  redirect(legacyListRedirect("not_bought", await searchParams));
}
