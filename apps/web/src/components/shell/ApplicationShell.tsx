import type { ComponentType, ReactNode } from "react";
import { Menu, PanelLeftClose } from "lucide-react";
import { sidebarCountLabel, type PageId } from "@jewelos/core";
import { useSidebarCounts } from "@/features/sidebar/useSidebarCounts";
import { Button } from "@/components/ui";
import { initials, titleCase } from "@/lib/format";
import type { Branch, UserProfile } from "@/types";
import { cn } from "@/lib/utils";
import { MobileNavigationDrawer, NavCountBadge, type MobileNavigationDrawerItem } from "./MobileNavigationDrawer";
import { MobileBottomNav } from "./MobileBottomNav";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { ThemeToggle, type Theme } from "@/components/ThemeToggle";

export type ShellNavItem = Readonly<{
  Icon: ComponentType<{ className?: string }>;
  id: PageId;
  label: string;
  path: string;
}>;

const SIDEBAR_BOTTOM_PAGE_IDS = new Set<PageId>(["dropdown_master", "reports", "settings"]);

export function getSidebarNavigation(nav: readonly ShellNavItem[]): Readonly<{ primary: readonly ShellNavItem[]; bottom: readonly ShellNavItem[] }> {
  const primary = nav.filter((item) => item.id !== "notifications" && !SIDEBAR_BOTTOM_PAGE_IDS.has(item.id) && item.id !== "users");
  const users = nav.filter((item) => item.id === "users");
  return {
    primary: [...primary, ...users],
    bottom: nav.filter((item) => SIDEBAR_BOTTOM_PAGE_IDS.has(item.id)),
  };
}

export function ApplicationShell({
  badges,
  branch,
  children,
  currentPage,
  developerModeActive = false,
  developerModeControl,
  developerSectionControls,
  drawerOpen,
  launcherItems,
  logoDarkUrl,
  logoLightUrl,
  nav,
  navigate,
  onDrawerOpenChange,
  onLogout,
  path,
  profile,
  sidebarOpen,
  setSidebarOpen,
  theme,
  onThemeChange,
  fullBleed = false,
}: {
  /** Counts shown next to navigation items, by page id. */
  badges?: Readonly<Record<string, number>> | undefined;
  branch: Branch | null;
  children: ReactNode;
  currentPage: PageId;
  developerModeActive?: boolean;
  developerModeControl?: ReactNode;
  developerSectionControls?: ReactNode;
  drawerOpen: boolean;
  launcherItems: readonly MobileNavigationDrawerItem[];
  logoDarkUrl: string;
  logoLightUrl: string;
  nav: readonly ShellNavItem[];
  navigate: (path: string) => void;
  onDrawerOpenChange: (open: boolean) => void;
  onLogout: () => Promise<void>;
  path: string;
  profile: UserProfile;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  fullBleed?: boolean;
}) {
  const sidebarNavigation = getSidebarNavigation(nav);
  const counts = useSidebarCounts(profile.id, profile.tenant_id);
  const navigateFromSidebar = (destination: string) => {
    navigate(destination);
    setSidebarOpen(false);
  };
  const sidebarItemClass = (selected: boolean) => cn(
    "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-[background-color,color,box-shadow] duration-150 active:scale-[0.99]",
    selected ? "bg-gold-sheen font-semibold text-on-gold shadow-gold" : "text-champagne hover:bg-gold/10 hover:text-gold-secondary",
  );
  const sidebarIconClass = (selected: boolean) => cn("size-[18px] shrink-0 transition-colors", selected ? "text-on-gold" : "text-soft-grey group-hover:text-gold-secondary");

  return (
    // `overflow-x-clip` on a normal element is a real clip: unlike the body
    // rule it cannot be bypassed by mobile Chrome zooming out to fit, or by
    // panning, when a page still has something wider than the screen. It does
    // not create a scroll container, so the sticky header keeps working.
    <div className="min-h-screen overflow-x-clip bg-obsidian">
      <header className={cn("sticky top-0 z-30 flex items-center bg-task-bg/90 px-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] backdrop-blur-xl supports-[backdrop-filter]:bg-task-bg/75 md:fixed md:inset-x-0 md:bg-charcoal/85 md:px-5", developerModeActive ? "min-h-[calc(3.5rem_+_env(safe-area-inset-top))] flex-wrap pb-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))] md:min-h-16 md:py-2" : "h-[calc(3.5rem_+_env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] md:h-16 md:pt-0")}>
        <div className="flex w-full min-w-0 items-center">
        <Button aria-label="Toggle sidebar" className="mr-3 hidden size-10 p-0 md:inline-flex" onClick={() => setSidebarOpen(!sidebarOpen)} variant="ghost">
          {sidebarOpen ? <PanelLeftClose /> : <Menu />}
        </Button>
        <Button aria-label="Open navigation" className="-ml-1 mr-1 size-10 p-0 md:hidden" onClick={() => onDrawerOpenChange(true)} variant="ghost">
          <Menu />
        </Button>
        {/* The wordmark gives way first: role-dependent controls on the right never overlap it. */}
        <button aria-label="MK Jewels, go to Home" className="mr-2 flex min-h-10 min-w-0 flex-1 items-center overflow-hidden rounded-lg px-1 transition-opacity hover:opacity-85" onClick={() => navigate("/")} type="button">
          <img alt="MK Jewels" className="h-4 w-auto min-w-0 max-w-full object-contain object-left drop-shadow-[0_1px_0_rgb(var(--color-gold-secondary)/0.35)] sm:h-[18px] md:h-5" src={theme === "dark" ? logoDarkUrl : logoLightUrl} />
        </button>
        <div className="flex shrink-0 items-center gap-1.5 md:gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-task-border bg-task-muted/60 px-3 py-1.5 text-xs font-medium text-champagne lg:inline-flex"><span aria-hidden className="size-1.5 rounded-full bg-success" />{branch?.name ?? "Branch unavailable"}</span>
          {developerModeControl}
          <ThemeToggle onChange={onThemeChange} theme={theme} />
          <NotificationBell onNavigate={navigate} profileId={profile.id} unreadCount={counts.notifications} />
          <span aria-label={profile.employee_name} className="flex size-9 items-center justify-center rounded-full bg-gold-sheen text-xs font-bold tracking-wide text-on-gold shadow-gold ring-2 ring-task-bg md:size-10 md:text-sm" role="img">
            {initials(profile.employee_name)}
          </span>
          <div className="hidden sm:block">
            <p className="max-w-36 truncate text-xs font-semibold text-white">{profile.employee_name}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gold-secondary">{titleCase(profile.user_role)}</p>
          </div>
        </div>
        </div>
        {developerModeActive && developerSectionControls ? <div className="mt-2 w-full border-t border-gold/20 pt-2">{developerSectionControls}</div> : null}
        {/* Gold hairline: the one brand accent the header carries on every screen. */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-task-border" />
        <span aria-hidden className="gold-rule pointer-events-none absolute inset-x-0 bottom-0 h-px opacity-70" />
      </header>

      <aside className={cn("fixed bottom-0 left-0 top-16 z-20 hidden w-64 flex-col border-r border-task-border bg-charcoal p-3 transition-transform duration-300 ease-out md:flex", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <nav aria-label="Primary navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto">
          <p aria-hidden className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-soft-grey">Workspace</p>
          {sidebarNavigation.primary.map(({ Icon, ...item }) => (
            <button
              aria-current={currentPage === item.id ? "page" : undefined}
              className={sidebarItemClass(currentPage === item.id)}
              key={item.id}
              onClick={() => navigateFromSidebar(item.path)}
              type="button"
            >
              <Icon className={sidebarIconClass(currentPage === item.id)} />{sidebarCountLabel(item.label, counts[item.id])}
              <NavCountBadge count={badges?.[item.id]} label="open questions for you" />
            </button>
          ))}
        </nav>
        {sidebarNavigation.bottom.length > 0 ? <nav aria-label="System navigation" className="mt-3 flex flex-col gap-1 border-t border-task-border pt-3">
          <p aria-hidden className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-soft-grey">System</p>
          {sidebarNavigation.bottom.map(({ Icon, ...item }) => (
            <button
              aria-current={currentPage === item.id ? "page" : undefined}
              className={sidebarItemClass(currentPage === item.id)}
              key={item.id}
              onClick={() => navigateFromSidebar(item.path)}
              type="button"
            >
              <Icon className={sidebarIconClass(currentPage === item.id)} />{sidebarCountLabel(item.label, counts[item.id])}
            </button>
          ))}
        </nav> : null}
        <p className="mt-3 px-3 text-[10px] uppercase tracking-[0.2em] text-soft-grey/80">JewelOS · MK Jewels</p>
      </aside>

      <main className={cn("pb-mobile-nav min-h-[calc(100dvh_-_3.5rem_-_env(safe-area-inset-top))] md:min-h-screen md:pt-16 md:transition-[padding]", developerModeActive && "md:pt-28", sidebarOpen && "md:pl-64")}>
        <div className={cn(fullBleed ? "w-full p-4 sm:p-6 [&>section]:max-w-none [&>section]:mx-0" : "mx-auto max-w-7xl p-4 sm:p-6")}>{children}</div>
      </main>

      <MobileBottomNav taskCount={counts.checklist_tasks} menuOpen={drawerOpen} onNavigate={navigate} onOpenMenu={() => onDrawerOpenChange(true)} path={path} />
      {drawerOpen ? <MobileNavigationDrawer counts={counts} badges={badges} branchName={branch?.name ?? "Branch unavailable"} currentPath={path} items={launcherItems} onClose={() => onDrawerOpenChange(false)} onLogout={onLogout} onNavigate={navigate} profileName={profile.employee_name} roleLabel={titleCase(profile.user_role)} /> : null}
    </div>
  );
}
