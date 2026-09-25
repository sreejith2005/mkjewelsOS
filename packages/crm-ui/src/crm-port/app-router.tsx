// crm-port: a minimal client-side stand-in for the Next.js App Router, so the original
// app/ tree runs unchanged inside JewelOS. Not part of the original source.
//
// Semantics kept from Next 16 for this app:
// - each original page is called as Next calls a server page (params/searchParams promises)
//   and its returned tree is rendered; router.refresh() re-runs the layout and page loaders
//   and reconciles the new tree, so client component state survives as it does in Next;
// - the (crm) layout is shared: it loads once (and on refresh) and is not re-run on
//   navigation between its pages; a page for another path remounts, a new search keeps it;
// - while a navigation loads, the current page stays on screen (there is no loading.tsx);
// - redirect() replaces the URL; notFound() from a page renders the default 404 inside the
//   (crm) layout, an unknown path renders it at the root; a trailing slash is removed
//   (trailingSlash: false);
// - after push/replace the page's first element is scrolled into view the way Next's
//   layout-router does; refresh and history traversal do not scroll.
import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import CrmLayout from "@/app/(crm)/layout";
import AllocationPage from "@/app/(crm)/allocation/page";
import ClientPage from "@/app/(crm)/clients/[clientId]/page";
import NewClientPage from "@/app/(crm)/clients/new/page";
import ClientsPage from "@/app/(crm)/clients/page";
import DashboardPage from "@/app/(crm)/dashboard/page";
import FollowupsPage from "@/app/(crm)/followups/page";
import NewLeadPage from "@/app/(crm)/leads/new/page";
import QueuePage from "@/app/(crm)/queue/page";
import ReferralsPage from "@/app/(crm)/referrals/page";
import NewVisitPage from "@/app/(crm)/visits/new/page";
import HomePage from "@/app/page";
import { redirect } from "@/next-shim/navigation";

import { CrmNavigationContext, type CrmAppRouter as AppRouter, type CrmNavigationState } from "./navigation-context";
import { NextNotFound } from "./not-found";
import { crmAppPath, crmHost, CrmLeave, CrmNotFound, CrmRedirect, withBasePath } from "./runtime";

type SearchParamsRecord = Record<string, string | string[]>;
type PageProps = { params: Promise<Record<string, string>>; searchParams: Promise<SearchParamsRecord> };
type PageLoader = (props: PageProps) => ReactNode | Promise<ReactNode> | void;
type Route = { segments: string[]; load: PageLoader; inCrmLayout: boolean };

// Next passes the same loosely typed params/searchParams objects to every page; each
// original page declares its own narrower shape, exactly as it did under Next.
// app/page.tsx only redirects, so a page may also "return" void.
const page = <P,>(component: (props: P) => ReactNode | Promise<ReactNode> | void): PageLoader => component as unknown as PageLoader;

// The original proxy (lib/supabase/proxy.ts) sends a signed-in visitor on /login to
// `nextUrl.pathname = crmPath("/")`. nextUrl already carries the basePath, so the result is
// /crm/crm, which the original answers with its 404. That behaviour is kept as-is (no fixes in
// the port). The login page itself is not ported: JewelOS login is the only CRM login.
function SignedInLoginPage(): void {
  redirect("/crm");
}

const ROUTES: Route[] = [
  { segments: [], load: page(HomePage), inCrmLayout: false },
  { segments: ["login"], load: page(SignedInLoginPage), inCrmLayout: false },
  { segments: ["dashboard"], load: page(DashboardPage), inCrmLayout: true },
  { segments: ["queue"], load: page(QueuePage), inCrmLayout: true },
  { segments: ["visits", "new"], load: page(NewVisitPage), inCrmLayout: true },
  { segments: ["clients"], load: page(ClientsPage), inCrmLayout: true },
  { segments: ["clients", "new"], load: page(NewClientPage), inCrmLayout: true },
  { segments: ["clients", "[clientId]"], load: page(ClientPage), inCrmLayout: true },
  { segments: ["followups"], load: page(FollowupsPage), inCrmLayout: true },
  { segments: ["referrals"], load: page(ReferralsPage), inCrmLayout: true },
  { segments: ["allocation"], load: page(AllocationPage), inCrmLayout: true },
  { segments: ["leads", "new"], load: page(NewLeadPage), inCrmLayout: true },
];

function matchRoute(pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split("/").filter(Boolean);
  let dynamicMatch: { route: Route; params: Record<string, string> } | null = null;
  for (const route of ROUTES) {
    if (route.segments.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let isStatic = true;
    const matches = route.segments.every((segment, index) => {
      const part = parts[index] ?? "";
      if (segment.startsWith("[") && segment.endsWith("]")) {
        isStatic = false;
        try { params[segment.slice(1, -1)] = decodeURIComponent(part); } catch { return false; }
        return true;
      }
      return segment === part;
    });
    if (!matches) continue;
    // Static segments win over dynamic ones ("/clients/new" is not a client id).
    if (isStatic) return { route, params };
    dynamicMatch ??= { route, params };
  }
  return dynamicMatch;
}

function searchParamsRecord(search: string): SearchParamsRecord {
  const record: SearchParamsRecord = {};
  for (const [key, value] of new URLSearchParams(search)) {
    const existing = record[key];
    record[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return record;
}

type Settled = { ok: true; value: ReactNode } | { ok: false; error: unknown };

async function settle(run: () => ReactNode | Promise<ReactNode> | void): Promise<Settled> {
  try {
    return { ok: true, value: (await run()) ?? null };
  } catch (error) {
    return { ok: false, error };
  }
}

function replaceBrowserUrl(url: string) {
  window.history.replaceState(window.history.state, "", url);
  // JewelOS tracks the URL through popstate; this makes the replaced URL its current route.
  window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
}

type PageView = { key: string; pathname: string; search: string; node: ReactNode; inCrmLayout: boolean };

const PageSlotContext = createContext<PageView | null>(null);

/** The (crm) layout's children: the current page, remounted when its path changes. */
function CrmPageSlot() {
  const view = useContext(PageSlotContext);
  return view ? <Fragment key={view.key}>{view.node}</Fragment> : null;
}

// Port of Next 16 layout-router ScrollAndFocusHandler (shouldSkipElement,
// topOfElementInViewport, handlePotentialScroll) for a completed navigation.
function scrollNavigatedPageIntoView() {
  const root = document.getElementById("crm-root");
  let domNode = root?.querySelector(":scope .crm-main")?.firstElementChild ?? root?.firstElementChild ?? null;
  const skip = (element: Element) => {
    if (["sticky", "fixed"].includes(getComputedStyle(element).position)) return true;
    const rect = element.getBoundingClientRect();
    return ["bottom", "height", "left", "right", "top", "width", "x", "y"].every((key) => rect[key as keyof DOMRect] === 0);
  };
  while (domNode && (!(domNode instanceof HTMLElement) || skip(domNode))) domNode = domNode.nextElementSibling;
  if (!(domNode instanceof HTMLElement)) return;
  const topInViewport = (element: HTMLElement, viewportHeight: number) => {
    const rects = element.getClientRects();
    if (rects.length === 0) return false;
    let top = Number.POSITIVE_INFINITY;
    for (const rect of Array.from(rects)) top = Math.min(top, rect.top);
    return top >= 0 && top <= viewportHeight;
  };
  const html = document.documentElement;
  const viewportHeight = html.clientHeight;
  if (!topInViewport(domNode, viewportHeight)) {
    html.scrollTop = 0;
    if (!topInViewport(domNode, viewportHeight)) domNode.scrollIntoView();
  }
  domNode.focus();
}

export function CrmAppRouter({ browserPath, browserSearch }: { browserPath: string; browserSearch: string }) {
  const pathname = crmAppPath(browserPath);
  const [refreshToken, setRefreshToken] = useState(0);
  const [view, setView] = useState<PageView | null>(null);
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);
  const layoutRef = useRef<{ node: ReactNode; refreshToken: number } | null>(null);
  const requestRef = useRef(0);
  const navigationKind = useRef<"history" | "navigate" | "refresh">("history");

  const router = useMemo<AppRouter>(() => ({
    push: (href) => { navigationKind.current = "navigate"; crmHost().navigate(withBasePath(href)); },
    replace: (href) => { navigationKind.current = "navigate"; replaceBrowserUrl(withBasePath(href)); },
    refresh: () => { navigationKind.current = "refresh"; setRefreshToken((token) => token + 1); },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    prefetch: () => undefined,
  }), []);

  useEffect(() => {
    if (pathname !== "/" && pathname.endsWith("/")) {
      replaceBrowserUrl(`${withBasePath(pathname.replace(/\/+$/, "") || "/")}${browserSearch}`);
      return;
    }
    const requestId = ++requestRef.current;
    const match = matchRoute(pathname);
    const props: PageProps = { params: Promise.resolve(match?.params ?? {}), searchParams: Promise.resolve(searchParamsRecord(browserSearch)) };
    const layout = layoutRef.current;
    const needsLayout = Boolean(match?.route.inCrmLayout) && (!layout || layout.refreshToken !== refreshToken);
    void (async () => {
      const [layoutResult, pageResult] = await Promise.all([
        needsLayout ? settle(() => CrmLayout({ children: <CrmPageSlot /> })) : Promise.resolve(null),
        match ? settle(() => match.route.load(props)) : Promise.resolve<Settled>({ ok: false, error: new CrmNotFound() }),
      ]);
      if (requestId !== requestRef.current) return;
      // The layout sits above the page, so its redirect/leave takes effect first.
      for (const result of [layoutResult, pageResult]) {
        if (!result || result.ok) continue;
        const { error } = result;
        if (error instanceof CrmRedirect) { navigationKind.current = "navigate"; replaceBrowserUrl(withBasePath(error.path)); return; }
        if (error instanceof CrmLeave) { crmHost().navigate(error.jewelosPath); return; }
        if (error instanceof CrmNotFound) {
          // notFound() from a page renders inside its layouts; an unmatched URL has none.
          const inCrmLayout = result === pageResult && Boolean(match?.route.inCrmLayout) && (layoutResult?.ok ?? Boolean(layoutRef.current));
          if (inCrmLayout && layoutResult?.ok) layoutRef.current = { node: layoutResult.value, refreshToken };
          setView({ key: `404:${pathname}`, pathname, search: browserSearch, node: <NextNotFound />, inCrmLayout });
          return;
        }
        setFailure({ error });
        return;
      }
      if (layoutResult?.ok) layoutRef.current = { node: layoutResult.value, refreshToken };
      if (pageResult.ok && match) setView({ key: pathname, pathname, search: browserSearch, node: pageResult.value, inCrmLayout: match.route.inCrmLayout });
    })();
  }, [pathname, browserSearch, refreshToken]);

  useLayoutEffect(() => {
    if (!view) return;
    if (navigationKind.current === "navigate") scrollNavigatedPageIntoView();
    navigationKind.current = "history";
  }, [view]);

  const navigation = useMemo<CrmNavigationState | null>(
    () => view ? { pathname: view.pathname, searchParams: new URLSearchParams(view.search), router } : null,
    [router, view],
  );

  if (failure) throw failure.error;
  if (!view || !navigation) return null;
  return <CrmNavigationContext.Provider value={navigation}>
    {view.inCrmLayout
      ? <PageSlotContext.Provider value={view}>{layoutRef.current?.node}</PageSlotContext.Provider>
      : <Fragment key={view.key}>{view.node}</Fragment>}
  </CrmNavigationContext.Provider>;
}
