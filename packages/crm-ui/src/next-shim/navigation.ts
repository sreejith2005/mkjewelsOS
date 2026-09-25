// crm-port: replaces next/navigation for the ported CRM. Paths are the original app paths
// ("/queue", "/clients/<id>"); the /crm base path is added exactly as Next's basePath did.
import { useMemo } from "react";

import { useCrmNavigation, type CrmAppRouter } from "@/crm-port/navigation-context";
import { CrmNotFound, CrmRedirect } from "@/crm-port/runtime";

export function useRouter(): CrmAppRouter {
  return useCrmNavigation().router;
}

export function usePathname(): string {
  return useCrmNavigation().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { searchParams } = useCrmNavigation();
  return useMemo(() => new URLSearchParams(searchParams), [searchParams]);
}

export function redirect(path: string): never {
  throw new CrmRedirect(path);
}

export function notFound(): never {
  throw new CrmNotFound();
}
