import type { ComponentType, ReactNode } from "react";
import { Menu, PanelLeftClose } from "lucide-react";
import type { PageId } from "@jewelos/core";
import { Button } from "@/components/ui";
import { initials, titleCase } from "@/lib/format";
import type { Branch, UserProfile } from "@/types";
import { cn } from "@/lib/utils";
import { MobileNavigationDrawer, type MobileNavigationDrawerItem } from "./MobileNavigationDrawer";
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

  return (
    <div className="min-h-screen bg-obsidian">
      <header className={cn("sticky top-0 z-30 flex items-center border-b border-task-border bg-task-bg px-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:fixed md:inset-x-0 md:border-gold/20 md:bg-charcoal/95 md:px-5 md:backdrop-blur", developerModeActive ? "min-h-[calc(3.5rem_+_env(safe-area-inset-top))] flex-wrap pb-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))] md:min-h-16 md:py-2" : "h-[calc(3.5rem_+_env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] md:h-16 md:pt-0")}>
        <div className="flex w-full items-center">
        <Button aria-label="Toggle sidebar" className="mr-3 hidden size-10 p-0 md:inline-flex" onClick={() => setSidebarOpen(!sidebarOpen)} variant="ghost">
          {sidebarOpen ? <PanelLeftClose /> : <Menu />}
        </Button>
        <Button aria-label="Open navigation" className="mr-2 size-10 p-0 md:hidden" onClick={() => onDrawerOpenChange(true)} variant="ghost">
          <Menu />
        </Button>
        <img alt="MK Jewels" className="h-7 w-28 object-contain object-left md:hidden" src={logoLightUrl} />
        <img alt="MK Jewels" className="hidden h-8 w-auto md:block" src={logoDarkUrl} />
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <span className="hidden text-sm text-champagne md:inline">{branch?.name ?? "Branch unavailable"}</span>
          {developerModeControl}
          <ThemeToggle onChange={onThemeChange} theme={theme} />
          <NotificationBell onNavigate={navigate} profileId={profile.id} />
          <span aria-label={profile.employee_name} className="flex size-10 items-center justify-center rounded-full bg-task-accent-soft text-sm font-bold text-task-text md:rounded-lg md:border md:border-gold/20 md:bg-obsidian md:text-gold" role="img">
            {initials(profile.employee_name)}
          </span>
          <div className="hidden sm:block">
            <p className="max-w-36 truncate text-xs font-semibold text-white">{profile.employee_name}</p>
            <p className="text-[10px] uppercase tracking-wider text-gold">{titleCase(profile.user_role)}</p>
          </div>
        </div>
        </div>
        {developerModeActive && developerSectionControls ? <div className="mt-2 w-full border-t border-gold/20 pt-2">{developerSectionControls}</div> : null}
      </header>

      <aside className={cn("fixed bottom-0 left-0 top-16 z-20 hidden w-64 flex-col border-r border-gold/20 bg-charcoal p-3 transition-transform md:flex", sidebarOpen ? "translate-x-0" : "-translate-x-full")}>
        <nav aria-label="Primary navigation" className="flex flex-1 flex-col gap-1 overflow-y-auto">
          {sidebarNavigation.primary.map(({ Icon, ...item }) => (
            <button
              className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition", currentPage === item.id ? "bg-gold text-obsidian" : "text-champagne hover:bg-gold/10 hover:text-gold")}
              key={item.id}
              onClick={() => navigate(item.path)}
              type="button"
            >
              <Icon className="size-4 shrink-0" />{item.label}
            </button>
          ))}
        </nav>
        {sidebarNavigation.bottom.length > 0 ? <nav aria-label="System navigation" className="mt-3 flex flex-col gap-1 border-t border-gold/20 pt-3">
          {sidebarNavigation.bottom.map(({ Icon, ...item }) => (
            <button
              className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition", currentPage === item.id ? "bg-gold text-obsidian" : "text-champagne hover:bg-gold/10 hover:text-gold")}
              key={item.id}
              onClick={() => navigate(item.path)}
              type="button"
            >
              <Icon className="size-4 shrink-0" />{item.label}
            </button>
          ))}
        </nav> : null}
      </aside>

      <main className={cn("pb-mobile-nav min-h-[calc(100dvh_-_3.5rem_-_env(safe-area-inset-top))] md:min-h-screen md:pt-16 md:transition-[padding]", developerModeActive && "md:pt-28", sidebarOpen && "md:pl-64")}>
        <div className={cn(fullBleed ? "w-full p-4 sm:p-6 [&>section]:max-w-none [&>section]:mx-0" : "mx-auto max-w-7xl p-4 sm:p-6")}>{children}</div>
      </main>

      <MobileBottomNav onNavigate={navigate} path={path} />
      {drawerOpen ? <MobileNavigationDrawer branchName={branch?.name ?? "Branch unavailable"} currentPath={path} items={launcherItems} onClose={() => onDrawerOpenChange(false)} onLogout={onLogout} onNavigate={navigate} profileName={profile.employee_name} roleLabel={titleCase(profile.user_role)} /> : null}
    </div>
  );
}
